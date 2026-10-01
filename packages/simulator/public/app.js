const transcript = document.querySelector('#transcript');
const form = document.querySelector('#composer');
const input = document.querySelector('#message');
const sendButton = document.querySelector('#send');
const resetButton = document.querySelector('#reset');
const inventory = document.querySelector('#inventory');
const ring = document.querySelector('.ring');

let sessionId = '';
const greeting = transcript.innerHTML;

function bubble(kind, text, toolCalls = []) {
  const li = document.createElement('li');
  li.className = `bubble ${kind}`;
  li.textContent = text;
  if (toolCalls.length) {
    const tools = document.createElement('div');
    tools.className = 'tools';
    for (const call of toolCalls) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `MCP · ${call.name}`;
      chip.title = call.result.split('\n')[0];
      tools.append(chip);
    }
    li.append(tools);
  }
  transcript.append(li);
  transcript.scrollTop = transcript.scrollHeight;
  return li;
}

function renderInventory(items) {
  inventory.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Nothing registered yet.';
    inventory.append(empty);
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = [item.brand, item.name].filter(Boolean).join(' ');
    if (item.model) {
      const small = document.createElement('small');
      small.textContent = `Model ${item.model}`;
      li.append(small);
    }
    inventory.append(li);
  }
}

function setBusy(busy) {
  sendButton.disabled = busy;
  input.disabled = busy;
  ring.classList.toggle('busy', busy);
  if (!busy) input.focus();
}

async function send(message) {
  bubble('user', message);
  setBusy(true);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, message }),
    });
    const data = await res.json();
    if (!res.ok) {
      bubble('error', data.error ?? 'Something went wrong.');
      return;
    }
    sessionId = data.sessionId;
    bubble('alexa', data.reply, data.toolCalls);
    renderInventory(data.items);
  } catch {
    bubble('error', 'I could not reach the server. Please try again.');
  } finally {
    setBusy(false);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  void send(message);
});

resetButton.addEventListener('click', async () => {
  await fetch('/api/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  }).catch(() => undefined);
  sessionId = '';
  transcript.innerHTML = greeting;
  renderInventory([]);
  input.focus();
});
