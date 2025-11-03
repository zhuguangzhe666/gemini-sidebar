// 1. (MODIFIED) 插件安装时...
chrome.runtime.onInstalled.addListener(() => {
  // (A) 创建右键菜单 (不变)
  chrome.contextMenus.create({
    id: "ask-gemini-selection",
    title: "✨ 用 Gemini 助手提问: \"%s\"",
    contexts: ["selection"]
  });
  
  // (B) (NEW) 将插件图标点击事件与打开侧边栏自动绑定
  // 这是“图标点击”的标准做法，它会替换掉旧的 action.onClicked 监听器
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Failed to set side panel behavior:', error));
});

// 2. 监听右键菜单的点击事件 (不变)
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "ask-gemini-selection") {
    const selectedText = info.selectionText;
    const tabId = tab.id;

    // (1) 打开侧边栏
    chrome.sidePanel.open({ tabId: tabId });

    // (2) 向侧边栏发送消息
    setTimeout(() => {
        chrome.runtime.sendMessage({
            type: 'SEND_SELECTION_TO_SIDEBAR',
            text: selectedText
        });
    }, 500);
  }
});


// 3. (REMOVED) 现有的图标点击监听器
// chrome.action.onClicked.addListener(...) 
// 这一整块被删除了，因为上面的 setPanelBehavior 已经替代了它的功能。


// 4. 现有的 API 调用监听器 (不变)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'callGemini') {
    callGeminiAPI(message.prompt, message.apiKey, message.model)
      .then(response => sendResponse(response))
      .catch(error => sendResponse(`API 调用失败: ${error.message}`));
    return true; 
  }
});

// 5. 现有的 callGeminiAPI 函数 (不变)
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