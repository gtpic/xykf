(function() {
    const scriptTag = document.currentScript;
    const API_BASE = scriptTag ? new URL(scriptTag.src).origin : ""; 
    let userId = localStorage.getItem("cs_user_id");
    if (userId && !/^\d+$/.test(userId)) {
        userId = null;
        localStorage.removeItem("cs_user_id");
    }
    const style = document.createElement('style');
    style.innerHTML = `
        #cs-widget { position: fixed; bottom: 20px; right: 20px; z-index: 9999; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        #cs-toggle { background: #007bff; color: white; border: none; border-radius: 50%; width: 56px; height: 56px; font-size: 24px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: flex; justify-content: center; align-items: center; transition: transform 0.2s; }
        #cs-toggle:hover { transform: scale(1.05); }
        #cs-panel { display: none; width: 340px; height: 500px; background: white; border-radius: 12px; box-shadow: 0 5px 25px rgba(0,0,0,0.2); flex-direction: column; overflow: hidden; margin-bottom: 15px; border: 1px solid #eee; }
        #cs-header { background: #007bff; color: white; padding: 16px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
        #cs-close { cursor: pointer; font-size: 22px; line-height: 1; }
        #cs-chat { flex: 1; padding: 16px; overflow-y: auto; background: #f9f9f9; display: flex; flex-direction: column; gap: 12px; }
        .cs-msg-row { display: flex; align-items: flex-end; gap: 8px; margin-bottom: 5px; }
        .cs-msg-row.user { flex-direction: row-reverse; }
        .cs-avatar { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; background: #e5e5ea; border: 1px solid #ddd; object-fit: cover; }
        .cs-msg { max-width: 75%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5; word-wrap: break-word; }
        .cs-msg.user { background: #95ec69; color: black; border-radius: 4px; }
        .cs-msg.agent { background: white; color: black; border-radius: 4px; border: 1px solid #eee; }
        #cs-input-area { display: flex; padding: 12px; border-top: 1px solid #eee; background: white; align-items: center; }
        #cs-input { flex: 1; padding: 10px 15px; border: 1px solid #ddd; border-radius: 20px; outline: none; font-size: 14px; }
        #cs-input:focus { border-color: #007bff; }
        #cs-send { background: none; border: none; color: #007bff; font-weight: bold; margin-left: 10px; cursor: pointer; font-size: 14px; padding: 5px 10px; }
    `;
    document.head.appendChild(style);

    const widgetHtml = `
        <div id="cs-panel">
            <div id="cs-header"><span>💬 在线客服<span id="cs-id-display" style="font-size:12px; font-weight:normal; margin-left:8px;"></span></span><span id="cs-close">&times;</span></div>
            <div id="cs-chat"></div>
            <div id="cs-input-area">
                <input type="text" id="cs-input" placeholder="输入你想咨询的问题...">
                <button id="cs-send">发送</button>
            </div>
        </div>
        <button id="cs-toggle" style="position:relative;">
            💬
            <span id="cs-unread" style="display:none; position:absolute; top:-2px; right:-2px; background:#ff4d4f; color:white; font-size:12px; font-weight:bold; padding:0 5px; height:18px; line-height:18px; border-radius:9px; box-shadow:0 2px 4px rgba(0,0,0,0.2);">0</span>
        </button>
        <audio id="cs-sound" src="https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3" preload="auto"></audio>
    `;
    const container = document.createElement('div');
    container.id = 'cs-widget';
    container.innerHTML = widgetHtml;
    document.body.appendChild(container);

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
            idDisplay.innerText = `[客户ID:${userId}]`;
        }
    }
    updateIdDisplay(); // 页面加载时如果有历史 ID 就显示出来
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
        if (historyLoaded || !userId) return; // 如果还没有 ID，说明是新访客，不需要拉历史记录
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
            if (userId) { // 只有获取到了数字 ID 后才开始轮询新消息
                try {
                    const res = await fetch(`${API_BASE}/api/customer/get-reply?userId=${userId}`);
                    if(res.ok) {
                        const data = await res.json();
                        if (data.replies && data.replies.length > 0) {
                            data.replies.forEach(msg => appendMsg(msg.content, 'agent'));
                            
                            // 尝试播放提示音 (浏览器策略要求用户必须先在页面有过点击交互才能播放声音)
                            try { notifySound.play(); } catch(e) {}
                            
                            // 如果聊天框当前是收起状态，则增加未读提示
                            if (panel.style.display !== 'flex') {
                                unreadCount += data.replies.length;
                                unreadBadge.innerText = '+' + unreadCount;
                                unreadBadge.style.display = 'block';
                            }
                        }
                    }
                } catch (e) {}
            }
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    toggle.onclick = () => { 
        panel.style.display = 'flex'; toggle.style.display = 'none'; 
        unreadCount = 0; unreadBadge.style.display = 'none'; 
        loadHistory(); startPolling(); 
    };
    
    close.onclick = () => { 
        panel.style.display = 'none'; toggle.style.display = 'flex'; 
        // 关键点：去掉了 isPolling = false，这样即使关闭面板，也会在后台继续接收新消息
    };

    // 关键点：如果老访客重新打开网页（存在历史ID），主动在后台启动轮询检测
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
            
            // 如果是发出的第一条消息，后端会分配一个自增数字 ID 返回
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
