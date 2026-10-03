import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Alert } from './alerts.js';
import { checkItems, recordAlerts } from './household-check.js';
import { buildRemedy } from './remedy.js';
import { reply, type ToolContext } from './tool-common.js';
import { severityRank } from './recalls/severity.js';
import { capitalize, firstSentence, spokenCount } from './voice.js';

const MAX_ITEMS_PER_CHECK = 25;

/** Small counts as words, which a voice reads better than digits: "two items". */
const plural = (n: number, one: string, many = `${one}s`) =>
  `${spokenCount(n)} ${n === 1 ? one : many}`;

/** The alert as the assistant and the UI see it. */
const alertView = (a: Alert) => ({
  alert_id: a.id,
  item_id: a.itemId,
  item: a.itemName,
  kind: a.kind,
  severity: a.severity,
  title: a.recall.title,
  hazard: a.recall.hazard,
  image_url: a.recall.imageUrl,
  published: a.recall.publishedAt,
  source: a.recall.source,
  question: a.question,
  created_at: a.createdAt,
});

export function registerAlertTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'check_household',
    {
      title: 'Check everything the household owns',
      description:
        'Check every registered item for recalls right now and record an alert for each recall found. ' +
        'Say only what the summary says: items with status "recalled" are recalled; "need_info" ones ' +
        'still need the question answered.',
      annotations: { openWorldHint: true },
    },
    async () => {
      const all = await ctx.store.listItems(ctx.householdId);
      if (all.length === 0) {
        return reply(
          "You haven't registered anything yet. Tell me about something you own and I'll check it.",
          { status: 'empty', checked: 0 },
        );
      }
      const items = all.slice(0, MAX_ITEMS_PER_CHECK);
      const outcomes = await checkItems(items, ctx.recalls, ctx.confirmer);
      const { all: touched } = await recordAlerts(ctx.alertStore, ctx.householdId, outcomes, {
        supersede: true,
      });

      // Best alert per item: a confirmed recall beats an open question.
      const best = new Map<string, Alert>();
      for (const a of touched) {
        const known = best.get(a.itemId);
        if (!known || (known.kind !== 'recalled' && a.kind === 'recalled')) best.set(a.itemId, a);
      }
      const ranked = [...best.values()];
      const recalled = ranked.filter((a) => a.kind === 'recalled');
      const needInfo = ranked.filter((a) => a.kind === 'need_info');
      const unchecked = items.filter((i) => !i.brand);
      // Sources that were down for an item with no match: its "no recall" is not trustworthy.
      const down = [
        ...new Set(outcomes.filter((o) => !o.matches.length).flatMap((o) => o.unavailable ?? [])),
      ];

      const open = needInfo.length + unchecked.length;
      const cannotCheck = unchecked[0]
        ? `I could not check your ${unchecked[0].name} because I do not know who makes it.`
        : undefined;
      const parts: string[] = [];
      const top = [...recalled].sort(
        (a, b) => severityRank(a.severity) - severityRank(b.severity),
      )[0];
      if (top) {
        // Lead with the danger; keep the rest to one short line each so it stays listenable.
        parts.push(
          `Your ${top.itemName} is recalled. ${firstSentence(top.recall.hazard || top.recall.title)}`,
        );
        const others = recalled.length - 1;
        if (others > 0) {
          parts.push(
            capitalize(
              `${plural(others, 'other item')} ${others === 1 ? 'is' : 'are'} recalled too.`,
            ),
          );
        }
        if (open > 0) {
          parts.push(
            capitalize(
              `${plural(open, 'other item')} still ${open === 1 ? 'needs' : 'need'} a little help from you.`,
            ),
          );
        }
      } else if (needInfo.length > 0) {
        parts.push(`I checked ${plural(items.length, 'item')}.`);
        parts.push(`I need one more detail to check ${plural(needInfo.length, 'item')}.`);
        if (cannotCheck) parts.push(cannotCheck);
      } else if (down.length) {
        parts.push(
          `I couldn't reach ${down.length === 1 ? `the ${down[0]} recall database` : 'some recall databases'} just now, so I can't confirm everything is clear yet. I'll check again in the daily scan.`,
        );
        if (cannotCheck) parts.push(cannotCheck);
      } else {
        parts.push(
          `Good news: I checked ${plural(items.length - unchecked.length, 'item')} and found no recalls.`,
        );
        if (cannotCheck) parts.push(cannotCheck);
      }
      return reply(parts.join(' '), {
        status: recalled.length
          ? 'recalled'
          : needInfo.length
            ? 'need_info'
            : down.length
              ? 'source_unavailable'
              : 'clear',
        ...(down.length ? { unavailable: down } : {}),
        checked: items.length - unchecked.length,
        recalled: recalled.map(alertView),
        need_info: needInfo.map(alertView),
        unchecked: unchecked.map((i) => ({ item_id: i.id, item: i.name })),
        skipped: all.length - items.length,
      });
    },
  );

  server.registerTool(
    'get_alerts',
    {
      title: 'List open recall alerts',
      description:
        'Open alerts for this household, most severe first: confirmed recalls, then items that still need a ' +
        'detail. Use get_remedy for the steps to fix a recall.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const alerts = await ctx.alertStore.listAlerts(ctx.householdId, 'open');
      if (alerts.length === 0) {
        return reply('You have no open recall alerts.', { count: 0, alerts: [] });
      }
      const top = alerts[0]!;
      const recalled = alerts.filter((a) => a.kind === 'recalled').length;
      const summary =
        top.kind === 'recalled'
          ? `You have ${plural(recalled, 'recall alert')}. The most urgent is your ${top.itemName}. ${firstSentence(top.recall.hazard || top.recall.title)} Want me to walk you through the fix?`
          : `I still need one detail to check your ${top.itemName}. ${top.question ?? ''}`.trim();
      return reply(summary, { count: alerts.length, alerts: alerts.map(alertView) });
    },
  );

  server.registerTool(
    'get_remedy',
    {
      title: 'How to fix a recall',
      description:
        'Step-by-step remedy for an alert: what to do right now, whether the fix is a free repair, ' +
        'replacement or refund, and who to contact. Read the summary aloud; links are only in the details.',
      inputSchema: { alert_id: z.string().describe('alert_id from get_alerts or check_household') },
      annotations: { readOnlyHint: true },
    },
    async ({ alert_id }) => {
      const alert = await ctx.alertStore.getAlert(ctx.householdId, alert_id);
      if (!alert) {
        return reply("I couldn't find that alert.", { status: 'not_found' });
      }
      if (alert.kind !== 'recalled') {
        return reply(
          `I am not sure yet that this recall covers your ${alert.itemName}. ${alert.question ?? ''}`.trim(),
          { status: 'need_info', ...alertView(alert) },
        );
      }
      const remedy = buildRemedy(alert);
      return reply(remedy.spoken, {
        status: 'remedy',
        ...alertView(alert),
        steps: remedy.steps,
        options: remedy.options,
        stop_using: remedy.stopUsing,
        phone: remedy.phone,
        web: remedy.web,
        recall_url: alert.recall.url,
      });
    },
  );

  server.registerTool(
    'resolve_alert',
    {
      title: 'Mark an alert as handled',
      description:
        'Close an alert once the user dealt with it: fixed (got the repair/replacement/refund), ' +
        'stopped_using, not_affected (checked the label: not in the recalled batch) or dismissed.',
      inputSchema: {
        alert_id: z.string().describe('alert_id from get_alerts'),
        resolution: z.enum(['fixed', 'stopped_using', 'not_affected', 'dismissed']),
      },
      annotations: { idempotentHint: true },
    },
    async ({ alert_id, resolution }) => {
      const existing = await ctx.alertStore.getAlert(ctx.householdId, alert_id);
      if (!existing) return reply("I couldn't find that alert.", { status: 'not_found' });
      if (existing.status === 'resolved') {
        return reply(`That alert for your ${existing.itemName} was already closed.`, {
          status: 'already_resolved',
          alert_id,
        });
      }
      const resolved = await ctx.alertStore.resolveAlert(ctx.householdId, alert_id, resolution);
      const sentence = {
        fixed: `Great, I marked the recall for your ${existing.itemName} as fixed.`,
        stopped_using: `Okay, I noted that you stopped using your ${existing.itemName}.`,
        not_affected: `Okay, I closed the alert for your ${existing.itemName}: it is not affected.`,
        dismissed: `Okay, I dismissed the alert for your ${existing.itemName}.`,
      }[resolution];
      const open = (await ctx.alertStore.listAlerts(ctx.householdId, 'open')).length;
      return reply(
        `${sentence} ${open ? `You have ${plural(open, 'open alert')} left.` : 'No open alerts left.'}`,
        {
          status: 'resolved',
          alert_id,
          resolution: resolved?.resolution,
          open_alerts: open,
        },
      );
    },
  );
}
