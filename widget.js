(function() {
    const scriptTag = document.currentScript;
    const API_BASE = scriptTag ? new URL(scriptTag.src).origin : ""; 

    // 读取可能已存在的数字 ID（如果是第一次来，则是 null）
    let userId = localStorage.getItem("cs_user_id");

    const style = document.createElement('style');
    style.innerHTML = `
        #cs-widget { position: fixed; bottom: 20px; right: 20px; z-index: 9999; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        #cs-toggle { background: #007bff; color: white; border: none; border-radius: 50%; width: 56px; height: 56px; font-size: 24px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: flex; justify-content: center; align-items: center; transition: transform 0.2s; }
        #cs-toggle:hover { transform: scale(1.05); }
        #cs-panel { display: none; width: 340px; height: 500px; background: white; border-radius: 12px; box-shadow: 0 5px 25px rgba(0,0,0,0.2); flex-direction: column; overflow: hidden; margin-bottom: 15px; border: 1px solid #eee; }
        #cs-header { background: #007bff; color: white; padding: 16px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
        #cs-close { cursor: pointer; font-size: 22px; line-height: 1; }
        #cs-chat { flex: 1; padding: 16px; overflow-y: auto; background: #f9f9f9; display: flex; flex-direction: column; gap: 12px; }
        .cs-msg { max-width: 80%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5; word-wrap: break-word; }
        .cs-msg.user { align-self: flex-end; background: #007bff; color: white; border-bottom-right-radius: 4px; }
        .cs-msg.agent { align-self: flex-start; background: #e5e5ea; color: black; border-bottom-left-radius: 4px; }
        #cs-input-area { display: flex; padding: 12px; border-top: 1px solid #eee; background: white; align-items: center; }
        #cs-input { flex: 1; padding: 10px 15px; border: 1px solid #ddd; border-radius: 20px; outline: none; font-size: 14px; }
        #cs-input:focus { border-color: #007bff; }
        #cs-send { background: none; border: none; color: #007bff; font-weight: bold; margin-left: 10px; cursor: pointer; font-size: 14px; padding: 5px 10px; }
    `;
    document.head.appendChild(style);

    const widgetHtml = `
        <div id="cs-panel">
            <div id="cs-header"><span>💬 在线客服</span><span id="cs-close">&times;</span></div>
            <div id="cs-chat"></div>
            <div id="cs-input-area">
                <input type="text" id="cs-input" placeholder="输入你想咨询的问题...">
                <button id="cs-send">发送</button>
            </div>
        </div>
        <button id="cs-toggle">💬</button>
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

    let isPolling = false;
    let historyLoaded = false;

    function appendMsg(text, sender) {
        const div = document.createElement("div");
        div.className = `cs-msg ${sender}`;
        div.innerText = text;
        chat.appendChild(div);
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
                        }
                    }
                } catch (e) {}
            }
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    toggle.onclick = () => { panel.style.display = 'flex'; toggle.style.display = 'none'; loadHistory(); startPolling(); };
    close.onclick = () => { panel.style.display = 'none'; toggle.style.display = 'flex'; isPolling = false; };

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
            }
        } catch (e) { console.error("发送失败", e); }
    }

    sendBtn.onclick = sendMessage;
    input.onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };
})();
