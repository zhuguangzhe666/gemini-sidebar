// 1. (MODIFIED) 插件安装时...
chrome.runtime.onInstalled.addListener(() => {
  // (A) 创建右键菜单 (不变)
  chrome.contextMenus.create({
    id: "ask-gemini-selection",
    title: "✨ 用 Gemini 助手提问: \"%s\"",
    contexts: ["selection"]
  });
  
  // (B) (NEW) 将插件图标点击事件与打开侧边栏自动绑定
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Failed to set side panel behavior:', error));
});

// 2. 监听右键菜单的点击事件 (添加错误处理)
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "ask-gemini-selection") {
    const selectedText = info.selectionText;
    
    // (FIXED) 添加安全检查，防止 tab 或 tab.id 为 undefined
    if (!tab || !tab.id) {
      console.error('无法获取 tab 信息，可能在不支持的页面（如 chrome:// 页面）');
      return;
    }
    
    const tabId = tab.id;

    // (1) 打开侧边栏
    chrome.sidePanel.open({ tabId: tabId }).catch((error) => {
      console.error('打开侧边栏失败:', error);
    });

    // (2) 向侧边栏发送消息
    setTimeout(() => {
        chrome.runtime.sendMessage({
            type: 'SEND_SELECTION_TO_SIDEBAR',
            text: selectedText
        });
    }, 500);
  }
});

// 4. (MODIFIED) 支持流式和普通 API 调用
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'callGemini') {
    callGeminiAPI(message.prompt, message.apiKey, message.model)
      .then(response => sendResponse(response))
      .catch(error => sendResponse(`API 调用失败: ${error.message}`));
    return true; 
  }
  
  // (NEW) 流式 API 调用 - 修复 sender.tab 可能为 undefined 的问题
  if (message.type === 'callGeminiStream') {
    // 修复：sender.tab 可能为 undefined（从 sidepanel 发送时）
    // 实际上 tabId 在这个函数中并未使用，可以传 null
    callGeminiStreamAPI(message.prompt, message.apiKey, message.model, null);
    return true;
  }
});

// 5. (NEW) 流式 API 调用函数 - 修复：移除未使用的 tabId 参数
async function callGeminiStreamAPI(prompt, apiKey, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: prompt
          }
        ]
      }
    ]
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      chrome.runtime.sendMessage({
        type: 'STREAM_ERROR',
        error: `HTTP 错误! 状态: ${response.status}`
      });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // 发送开始信号
    chrome.runtime.sendMessage({
      type: 'STREAM_START'
    });

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        // 发送完成信号
        chrome.runtime.sendMessage({
          type: 'STREAM_END'
        });
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 保留不完整的行

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const jsonStr = line.slice(6); // 移除 "data: "
            const data = JSON.parse(jsonStr);
            
            if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
              const text = data.candidates[0].content.parts[0].text;
              
              // 发送文本片段
              chrome.runtime.sendMessage({
                type: 'STREAM_CHUNK',
                text: text
              });
            }
          } catch (e) {
            console.error('解析 SSE 数据失败:', e);
          }
        }
      }
    }

  } catch (error) {
    chrome.runtime.sendMessage({
      type: 'STREAM_ERROR',
      error: error.message
    });
  }
}

// 6. 现有的普通 API 调用函数 (保留作为备用)
async function callGeminiAPI(prompt, apiKey, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: prompt
          }
        ]
      }
    ]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`HTTP 错误! 状态: ${response.status}`);
  }

  const data = await response.json();
  
  try {
    return data.candidates[0].content.parts[0].text;
  } catch (e) {
    console.error("解析 Gemini 响应失败:", data);
    throw new Error("未能解析 API 响应。");
  }
}
