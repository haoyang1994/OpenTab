const inputArea = document.getElementById('input-area');
const outputArea = document.getElementById('output-area');
const inputStatus = document.getElementById('input-status');
const outputStatus = document.getElementById('output-status');
const formatBtn = document.getElementById('format-btn');
const minifyBtn = document.getElementById('minify-btn');
const clearBtn = document.getElementById('clear-btn');
const copyBtn = document.getElementById('copy-btn');

function setStatus(element, text, type) {
  element.textContent = text;
  element.className = 'status ' + (type || '');
}

function format() {
  const input = inputArea.value.trim();
  if (!input) {
    setStatus(inputStatus, '请输入内容', 'error');
    return;
  }

  try {
    const parsed = JSON.parse(input);
    const formatted = JSON.stringify(parsed, null, 2);
    outputArea.value = formatted;
    setStatus(outputStatus, '格式化成功', 'success');
    setStatus(inputStatus, '有效 JSON', 'success');
  } catch (e) {
    setStatus(inputStatus, 'JSON 格式错误: ' + e.message, 'error');
    setStatus(outputStatus, '', '');
  }
}

function minify() {
  const input = inputArea.value.trim();
  if (!input) {
    setStatus(inputStatus, '请输入内容', 'error');
    return;
  }

  try {
    const parsed = JSON.parse(input);
    const minified = JSON.stringify(parsed);
    outputArea.value = minified;
    setStatus(outputStatus, '压缩成功', 'success');
    setStatus(inputStatus, '有效 JSON', 'success');
  } catch (e) {
    setStatus(inputStatus, 'JSON 格式错误: ' + e.message, 'error');
    setStatus(outputStatus, '', '');
  }
}

function clear() {
  inputArea.value = '';
  outputArea.value = '';
  setStatus(inputStatus, '', '');
  setStatus(outputStatus, '', '');
  inputArea.focus();
}

async function copy() {
  if (!outputArea.value) return;
  try {
    await navigator.clipboard.writeText(outputArea.value);
    setStatus(outputStatus, '已复制', 'success');
  } catch (e) {
    setStatus(outputStatus, '复制失败', 'error');
  }
}

formatBtn.addEventListener('click', format);
minifyBtn.addEventListener('click', minify);
clearBtn.addEventListener('click', clear);
copyBtn.addEventListener('click', copy);

inputArea.addEventListener('input', () => {
  const input = inputArea.value.trim();
  if (!input) {
    setStatus(inputStatus, '', '');
    return;
  }
  try {
    JSON.parse(input);
    setStatus(inputStatus, '有效 JSON', 'success');
  } catch (e) {
    setStatus(inputStatus, '无效 JSON', 'error');
  }
});

inputArea.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = inputArea.selectionStart;
    const end = inputArea.selectionEnd;
    inputArea.value = inputArea.value.substring(0, start) + '  ' + inputArea.value.substring(end);
    inputArea.selectionStart = inputArea.selectionEnd = start + 2;
  }
});
