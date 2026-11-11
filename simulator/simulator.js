const conversation = document.querySelector("#conversation");
const composer = document.querySelector("#composer");
const question = document.querySelector("#question");
const stopButton = document.querySelector("#stop");
const regenerateButton = document.querySelector("#regenerate");
let current = null;
let exchangeCounter = 0;

const answers = [
  "RAG first converts reference material into embeddings and stores them in a vector database. When a question arrives, retrieval finds relevant passages and adds them to the model's context. This grounding can reduce hallucinations because the answer has supporting material.",
  "Retrieval-augmented generation connects a language model to external evidence. A vector database supports semantic search, and the retrieved passages guide the response. The method reduces unsupported claims when the sources are relevant."
];

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = question.value.trim();
  if (!text) return;
  stopCurrent();
  const exchangeId = `exchange-${++exchangeCounter}`;
  appendMessage("user", text, exchangeId);
  const answer = /rag|hallucinat/i.test(text) ? answers[0] : "Here is a short and friendly response to your request.";
  streamAnswer(exchangeId, answer);
});

stopButton.addEventListener("click", stopCurrent);
regenerateButton.addEventListener("click", () => {
  if (!current?.exchangeId) return;
  stopCurrent();
  const old = conversation.querySelector(`[data-role="assistant-message"][data-exchange-id="${current.exchangeId}"]`);
  old?.remove();
  streamAnswer(current.exchangeId, answers[1]);
});
document.querySelector("#newConversation").addEventListener("click", () => {
  stopCurrent();
  conversation.replaceChildren();
  history.pushState({}, "", `/?conversation=${Date.now()}`);
  regenerateButton.disabled = true;
});

function appendMessage(role, text, exchangeId) {
  const node = document.createElement("article");
  node.className = `message ${role}`;
  node.dataset.role = `${role}-message`;
  node.dataset.exchangeId = exchangeId;
  node.textContent = text;
  conversation.append(node);
  return node;
}

function streamAnswer(exchangeId, text) {
  const node = appendMessage("assistant", "", exchangeId);
  const words = text.split(" ");
  let index = 0;
  stopButton.disabled = false;
  regenerateButton.disabled = true;
  const timer = setInterval(() => {
    node.textContent += `${index ? " " : ""}${words[index++]}`;
    if (index >= words.length) finish();
  }, 55);
  current = { exchangeId, timer, node };
  function finish() {
    clearInterval(timer);
    node.dataset.complete = "true";
    stopButton.disabled = true;
    regenerateButton.disabled = false;
  }
}

function stopCurrent() {
  if (!current) return;
  clearInterval(current.timer);
  current.node.dataset.complete = "stopped";
  stopButton.disabled = true;
  regenerateButton.disabled = false;
}
