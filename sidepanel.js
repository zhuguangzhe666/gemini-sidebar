// --- 1. 获取元素 ---
// 设置
const settingsToggle = document.getElementById('settings-toggle');
const apiKeySection = document.getElementById('api-key-section');
const apiKeyInput = document.getElementById('api-key');
const saveKeyButton = document.getElementById('save-key');
const saveStatusDiv = document.getElementById('save-status');
const themeToggle = document.getElementById('theme-toggle');
const modelSelect = document.getElementById('model-select');

// 聊天
const chatContainer = document.getElementById('chat-container');
const promptInput = document.getElementById('prompt-input');

// (MODIFIED) 引用相关元素
const quotedSection = document.getElementById('quoted-section');
const quotedSectionContent = document.getElementById('quoted-section-content'); // (NEW) 引用内容显示区域
const clearQuoteButton = document.getElementById('clear-quote');           // (NEW) 清除引用按钮

let currentQuotedText = ''; 


// --- 2. 设置区域逻辑 ---
// 切换设置的显示
settingsToggle.addEventListener('click', () => {
  const isHidden = apiKeySection.style.display === 'none';
  apiKeySection.style.display = isHidden ? 'block' : 'none';
});

// 保存 API 密钥
saveKeyButton.addEventListener('click', () => {
  const apiKey = apiKeyInput.value;
  if (!apiKey) {
    saveStatusDiv.innerText = '请输入 API 密钥！';
    saveStatusDiv.style.color = '#ff4d4d';
    return;
  }
  chrome.storage.local.set({ geminiApiKey: apiKey }, () => {
    saveStatusDiv.innerText = 'API 密钥已保存！';
    saveStatusDiv.style.color = 'var(--primary-color)';
    apiKeyInput.value = '';
    apiKeyInput.placeholder = '密钥已保存，可输入新密钥覆盖';
    setTimeout(() => {
      apiKeySection.style.display = 'none';
      saveStatusDiv.innerText = '';
    }, 1500);
  });
});

// 保存模型选择
modelSelect.addEventListener('change', () => {
  const selectedModel = modelSelect.value;
  chrome.storage.local.set({ geminiModel: selectedModel }, () => {
    console.log('Model preference saved:', selectedModel);
    saveStatusDiv.innerText = '模型已切换！';
    saveStatusDiv.style.color = 'var(--primary-color)';
    setTimeout(() => { saveStatusDiv.innerText = ''; }, 1500);
  });
});

// 主题切换逻辑
themeToggle.addEventListener('click', () => {
  const isLight = document.body.classList.toggle('light-theme');
  
  if (isLight) {
    themeToggle.innerText = '☀️';
    chrome.storage.local.set({ theme: 'light' });
  } else {
    themeToggle.innerText = '🌙';
    chrome.storage.local.set({ theme: 'dark' });
  }
});

// (NEW) 清除引用按钮的事件监听器
clearQuoteButton.addEventListener('click', () => {
  clearQuotedText();
});

// 页面加载时
document.addEventListener('DOMContentLoaded', () => {
  // 加载主题
  chrome.storage.local.get(['theme'], (result) => {
    if (result.theme === 'light') {
      document.body.classList.add('light-theme');
      themeToggle.innerText = '☀️';
    } else {
      document.body.classList.remove('light-theme');
      themeToggle.innerText = '🌙';
    }
  });

  // 加载 API 密钥状态
  chrome.storage.local.get(['geminiApiKey'], (result) => {
    if (result.geminiApiKey) {
      apiKeyInput.placeholder = '密钥已保存，可输入新密钥覆盖';
    }
  });

  // 加载并设置保存的模型
  chrome.storage.local.get(['geminiModel'], (result) => {
    if (result.geminiModel) {
      modelSelect.value = result.geminiModel;
    }
  });

  // 页面加载时添加欢迎语
  addMessageToChat('bot', '你好！我是 Eric 的 Gemini 助手。准备好开始了吗？');

  // 注册划词消息监听器
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SEND_SELECTION_TO_SIDEBAR') {
      setQuotedText(message.text);
      promptInput.value = '';
      promptInput.focus();
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  });
});


// --- 3. 聊天核心逻辑 ---

// "回车发送" 逻辑
promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault(); 
    handleSend();
  }
});

// (MODIFIED) 发送消息的处理函数
async function handleSend() {
  const userQuestion = promptInput.value.trim();
  const quotedText = currentQuotedText; 
  const selectedModel = modelSelect.value; 

  const result = await chrome.storage.local.get(['geminiApiKey']);
  const apiKey = result.geminiApiKey;
  if (!apiKey) {
    addMessageToChat('bot', '错误：请先点击右上角 ⚙️ 设置并保存您的 API 密钥！', 'error');
    return;
  }

  if (!userQuestion && !quotedText) {
    return;
  }

  // --- A. 构建发送给 API 的完整提示词 ---
  let fullPrompt = '';
  if (quotedText) {
    fullPrompt += `用户引用了以下内容：\n\n"""\n${quotedText}\n"""\n\n`;
  }
  if (userQuestion) {
    fullPrompt += `用户的问题是：${userQuestion}`;
  } else if (quotedText && !userQuestion) {
    fullPrompt += "请针对以上引用内容进行总结或分析。";
  }

  // --- B. 更新聊天界面 (UI) ---
  if (quotedText) {
    addMessageToChat('user', `引用了："${quotedText}"`);
    // (REMOVED) 这里不再自动清除引用
  }
  if (userQuestion) {
    addMessageToChat('user', userQuestion);
  } else if (quotedText && !userQuestion) {
    addMessageToChat('bot', '（无具体问题，将对引用内容进行默认处理）');
  }

  promptInput.value = ''; 
  const thinkingBubble = addMessageToChat('bot', '... 思考中 ...');

  // --- C. 调用 API ---
  try {
    const responseText = await chrome.runtime.sendMessage({
      type: 'callGemini',
      prompt: fullPrompt, 
      apiKey: apiKey,
      model: selectedModel 
    });
    
    thinkingBubble.innerHTML = marked.parse(responseText); 

  } catch (error) {
    thinkingBubble.innerText = `发生错误: ${error.message}`;
    thinkingBubble.classList.add('error');
  }
}

/**
 * 辅助函数：向聊天容器添加消息
 */
function addMessageToChat(role, text, type = null) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}-message`;
  
  if (type === 'error') {
    bubble.classList.add('error');
  }
  
  if (role === 'bot') { 
      bubble.innerHTML = marked.parse(text);
  } else {
      bubble.innerText = text;
  }
  
  chatContainer.appendChild(bubble);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return bubble;
}

// (MODIFIED) 设置引用文本的函数
function setQuotedText(text) {
  currentQuotedText = text;
  quotedSectionContent.innerText = text; // (MODIFIED) 填充到新的 content 区域
  quotedSection.style.display = 'block'; 
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// (MODIFIED) 清除引用文本的函数
function clearQuotedText() {
  currentQuotedText = '';
  quotedSectionContent.innerText = ''; // (MODIFIED) 清空 content 区域
  quotedSection.style.display = 'none'; 
}