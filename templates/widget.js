(function() {
    // 1. 基础设置与 ID 获取 (保持与原版逻辑一致)
    const scriptTag = document.currentScript;
    const API_BASE = scriptTag ? new URL(scriptTag.src).origin : ""; 
    let userId = localStorage.getItem("cs_user_id");
    if (userId && !/^\d+$/.test(userId)) {
        userId = null;
        localStorage.removeItem("cs_user_id");
    }

    const style = document.createElement('style');
    style.innerHTML = `
       /* 容器与全局字体 */
        #cs-widget { position: fixed; bottom: 24px; right: 24px; z-index: 9999; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; flex-direction: column; align-items: flex-end; }
        #cs-widget * { outline: none !important; -webkit-tap-highlight-color: transparent !important; }
        /* 悬浮按钮 - 渐变色、阴影与悬浮放大效果 */
        #cs-toggle { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); width: 64px; height: 64px; border-radius: 32px; border: none; cursor: pointer; box-shadow: 0 8px 24px rgba(118, 75, 162, 0.4); display: flex; align-items: center; justify-content: center; transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); position: relative; }
        #cs-toggle:hover { transform: translateY(-4px) scale(1.05); box-shadow: 0 14px 28px rgba(118, 75, 162, 0.5); }
        #cs-toggle svg { width: 32px; height: 32px; fill: white; transition: transform 0.3s; }
        
        /* 未读消息红点 */
        #cs-unread { display: none; position: absolute; top: -2px; right: -2px; background: #ff3b30; color: white; font-size: 12px; font-weight: bold; padding: 0 6px; min-width: 10px; height: 22px; line-height: 20px; border-radius: 11px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
        
       /* 聊天面板主窗体 - 毛玻璃边框与圆角 */
        #cs-panel { position: absolute; bottom: 18px; right: 0; display: none; width: 320px; height: 580px; background: #ffffff; border-radius: 20px; box-shadow: 0 15px 40px rgba(0,0,0,0.12); flex-direction: column; overflow: hidden; border: 1px solid rgba(0,0,0,0.05); opacity: 0; transform: translateY(20px); transition: opacity 0.3s ease, transform 0.3s ease; }
        /* 面板头部 - 渐变色 */
        #cs-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px 20px; display: flex; justify-content: space-between; align-items: center; }
        #cs-header-info { display: flex; flex-direction: column; }
        #cs-header-title { font-size: 16px; font-weight: 600; display: flex; align-items: center; }
        #cs-header-title svg { width: 18px; height: 18px; fill: white; margin-right: 8px; }
        #cs-id-display { font-size: 12px; opacity: 0.8; margin-top: 4px; font-weight: 400; }
        
        /* 关闭按钮 */
        #cs-close { cursor: pointer; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.2); border-radius: 50%; transition: background 0.2s; }
        #cs-close:hover { background: rgba(255,255,255,0.3); }
        #cs-close svg { width: 14px; height: 14px; fill: white; }
        
        /* 聊天内容区 */
        #cs-chat { flex: 1; padding: 16px; overflow-y: auto; background: #f8f9fa; display: flex; flex-direction: column; }
        #cs-chat::-webkit-scrollbar { width: 6px; }
        #cs-chat::-webkit-scrollbar-track { background: transparent; }
        #cs-chat::-webkit-scrollbar-thumb { background: #dcdcdc; border-radius: 3px; }
        
        /* 消息行与头像 */
        .cs-msg-row { display: flex; align-items: flex-end; margin-bottom: 10px; animation: fadeIn 0.3s ease; }
        .cs-msg-row:last-child { margin-bottom: 0; }
        .cs-msg-row .cs-avatar { margin-right: 5px; }
        .cs-msg-row.user { flex-direction: row-reverse; }
        .cs-msg-row.user .cs-avatar { margin-right: 0; margin-left: 5px; }
        .cs-avatar { width: 36px; height: 36px; border-radius: 12px; flex-shrink: 0; background: white; object-fit: cover; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
        
        /* 聊天气泡 */
        .cs-msg { max-width: 72%; padding: 8px 10px; font-size: 14px; line-height: 1.5; word-wrap: break-word; box-shadow: 0 2px 8px rgba(0,0,0,0.03); }
        .cs-msg.agent { background: white; color: #333; border-radius: 16px 16px 16px 4px; border: 1px solid #f0f0f0; }
        .cs-msg.user { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 16px 16px 4px 16px; }
        
        /* 输入区 */
        #cs-input-area { padding: 16px; background: white; border-top: 1px solid #f0f0f0; display: flex; align-items: center; }
        #cs-input { flex: 1; margin-right: 12px; padding: 12px 16px; border: 1px solid #e4e4e4; border-radius: 24px; outline: none; font-size: 14px; background: #f8f9fa; transition: all 0.3s; }
        #cs-input:focus { border-color: #764ba2; background: white; box-shadow: 0 0 0 3px rgba(118, 75, 162, 0.1); }
        
        /* 发送按钮 */
        #cs-send { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; width: 42px; height: 42px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(118, 75, 162, 0.3); transition: transform 0.2s; flex-shrink: 0; }
        #cs-send:hover { transform: scale(1.1); }
        #cs-send svg { width: 18px; height: 18px; fill: white; transform: translateX(0px); } /* 让纸飞机视觉居中 */
        
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        
        /* 移动端按屏幕宽度等比缩小适配 */
        @media (max-width: 480px) { #cs-widget { transform-origin: bottom right; transform: scale(0.9); } }
        @media (max-width: 400px) { 
            #cs-widget { transform-origin: bottom right; transform: scale(0.8); } 
            .cs-msg, #cs-input { font-size: 16px; } 
            #cs-chat { gap: 20px; } 
        }
        @media (max-width: 350px) { 
            #cs-widget { transform-origin: bottom right; transform: scale(0.7); } 
            #cs-panel { height: 430px; right: calc((50vw - 24px) / 0.7 - 180px); } 
            .cs-msg, #cs-input { font-size: 18px; } 
            #cs-chat { gap: 24px; } 
            .cs-msg { padding: 14px 20px; } 
        }
    `;
    document.head.appendChild(style);

    // 3. 构建 HTML 结构 (使用 SVG 矢量图标)
    const widgetHtml = `
        <div id="cs-panel">
            <div id="cs-header">
                <div id="cs-header-info">
                    <div id="cs-header-title">
                        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12c0 1.54.36 2.98.97 4.29L1 23l6.71-1.97C9.02 21.64 10.46 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18c-1.22 0-2.39-.24-3.46-.68l-.8-.33-3.61 1.06.96-3.52-.36-.78C3.54 14.53 3 13.31 3 12c0-4.96 4.04-9 9-9s9 4.04 9 9-4.04 9-9 9z"/></svg>
                        在线客服
                    </div>
                    <div id="cs-id-display">为您提供专属服务</div>
                </div>
                <div id="cs-close">
                    <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </div>
            </div>
            <div id="cs-chat"></div>
            <div id="cs-input-area">
                <input type="text" id="cs-input" placeholder="输入你想咨询的问题...">
                <button id="cs-send">
                    <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </button>
            </div>
        </div>
        <button id="cs-toggle">
            <svg viewBox="0 0 24 24" id="cs-toggle-icon"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
            <span id="cs-unread">0</span>
        </button>
        <audio id="cs-sound" src="https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3" preload="auto"></audio>
    `;
    const container = document.createElement('div');
    container.id = 'cs-widget';
    container.innerHTML = widgetHtml;
    document.body.appendChild(container);

    // 4. 核心逻辑 (完全继承原代码，保证通信正常)
    const panel = document.getElementById("cs-panel");
    const toggle = document.getElementById("cs-toggle");
    const close = document.getElementById("cs-close");
    const chat = document.getElementById("cs-chat");
    const input = document.getElementById("cs-input");
    const sendBtn = document.getElementById("cs-send");
    const idDisplay = document.getElementById("cs-id-display");
    const unreadBadge = document.getElementById("cs-unread");
    const notifySound = document.getElementById("cs-sound");
    
    let unreadCount = 0;
    function updateIdDisplay() {
        if (idDisplay && userId) {
            idDisplay.innerText = `[客户ID: ${userId}] 专属服务中`;
        }
    }
    updateIdDisplay();

    let isPolling = false;
    let historyLoaded = false;
    let widgetConfig = { agent_icon: '', user_icon: '' };
    fetch(`${API_BASE}/api/customer/config`).then(r => r.json()).then(data => widgetConfig = data).catch(e => {});

    function appendMsg(text, sender) {
        const row = document.createElement("div");
        row.className = `cs-msg-row ${sender}`;
        
        const avatar = document.createElement("img");
        avatar.className = "cs-avatar";
        const seed = sender === 'agent' ? 'kefu' : (userId || Math.random());
        if (sender === 'agent') {
            avatar.src = widgetConfig.agent_icon || 'https://api.dicebear.com/7.x/bottts/svg?seed=kefu';
        } else {
            avatar.src = widgetConfig.user_icon || `https://api.dicebear.com/7.x/adventurer/svg?seed=${seed}`;
        }
        
        const msgDiv = document.createElement("div");
        msgDiv.className = `cs-msg ${sender}`;
        msgDiv.innerText = text;

        row.appendChild(avatar);
        row.appendChild(msgDiv);
        
        chat.appendChild(row);
        chat.scrollTop = chat.scrollHeight;
    }

    async function loadHistory() {
        if (historyLoaded || !userId) return; 
        try {
            const res = await fetch(`${API_BASE}/api/customer/history?userId=${userId}`);
            const data = await res.json();
            if (data.history && data.history.length > 0) {
                chat.innerHTML = '';
                data.history.forEach(msg => appendMsg(msg.content, msg.sender));
            }
            historyLoaded = true;
        } catch (e) { console.error("加载历史失败", e); }
    }

    async function startPolling() {
        if (isPolling) return;
        isPolling = true;
        while (isPolling) {
            if (userId) {
                try {
                    const res = await fetch(`${API_BASE}/api/customer/get-reply?userId=${userId}`);
                    if(res.ok) {
                        const data = await res.json();
                        if (data.replies && data.replies.length > 0) {
                            data.replies.forEach(msg => appendMsg(msg.content, 'agent'));
                            try { notifySound.play(); } catch(e) {}
                            
                            if (panel.style.display !== 'flex') {
                                unreadCount += data.replies.length;
                                unreadBadge.innerText = unreadCount > 99 ? '99+' : unreadCount;
                                unreadBadge.style.display = 'block';
                            }
                        }
                    }
                } catch (e) {}
            }
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    // 加入了一点动画延迟逻辑，让展开/收起更平滑
    toggle.onclick = () => { 
        panel.style.display = 'flex'; 
        setTimeout(() => { panel.style.opacity = '1'; panel.style.transform = 'translateY(0)'; }, 10);
        toggle.style.transform = 'scale(0)'; 
        setTimeout(() => { toggle.style.display = 'none'; toggle.style.transform = ''; }, 300);
        
        unreadCount = 0; unreadBadge.style.display = 'none'; 
        loadHistory(); startPolling(); 
    };
    
    close.onclick = () => { 
        panel.style.opacity = '0'; panel.style.transform = 'translateY(20px)';
        setTimeout(() => { panel.style.display = 'none'; }, 300);
        
        toggle.style.display = 'flex'; 
        toggle.style.transform = 'scale(0)';
        setTimeout(() => { toggle.style.transform = 'scale(1)'; }, 10);
    };

    if (userId) {
        startPolling();
    }

    async function sendMessage() {
        const text = input.value.trim();
        if (!text) return;
        appendMsg(text, 'user');
        input.value = '';
        try {
            const res = await fetch(`${API_BASE}/api/customer/send`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: userId, content: text })
            });
            const data = await res.json();
            
            if (data.success && data.userId && !userId) {
                userId = data.userId;
                localStorage.setItem("cs_user_id", userId);
                updateIdDisplay();
            }
        } catch (e) { console.error("发送失败", e); }
    }

    sendBtn.onclick = sendMessage;
    input.onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };
})();
