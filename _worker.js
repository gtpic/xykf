export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/tg/")) {
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      };
      if (method === "OPTIONS") return new Response(null, { headers: corsHeaders });

      try {
        const configRows = await env.db.prepare("SELECT key, value FROM config").all();
        const config = Object.fromEntries(configRows.results.map(r => [r.key, r.value]));

        async function checkAuth(req) {
          const authHeader = req.headers.get("Authorization");
          if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
          const token = authHeader.split(" ")[1];
          return (await env.kv.get(`auth_${token}`)) === "valid";
        }

        /* ================= Admin API ================= */
        if (url.pathname === "/api/admin/login" && method === "POST") {
          const { username, password } = await request.json();
          if (username === config.admin_username && password === config.admin_password) {
            const token = crypto.randomUUID();
            await env.kv.put(`auth_${token}`, "valid", { expirationTtl: 86400 });
            return new Response(JSON.stringify({ success: true, token }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          return new Response(JSON.stringify({ success: false, message: "账号或密码错误" }), { status: 401, headers: corsHeaders });
        }

        if (url.pathname.startsWith("/api/admin/") && url.pathname !== "/api/admin/login") {
          if (!(await checkAuth(request))) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

          if (url.pathname === "/api/admin/config" && method === "GET") {
            const safeConfig = { ...config };
            delete safeConfig.admin_password;
            return new Response(JSON.stringify(safeConfig), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          if (url.pathname === "/api/admin/update-config" && method === "POST") {
            const reqData = await request.json();
            const { username, password, botToken, chatId, agentIcon, userIcon, autoReply, quickReply, widgetTheme, faqList, imgStorage, r2Domain, pcIconSize, pcIconPos, mobileIconSize, mobileIconPos } = reqData;
            if (imgStorage !== undefined) await env.db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('img_storage', ?)").bind(imgStorage).run();
            if (r2Domain !== undefined) await env.db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('r2_domain', ?)").bind(r2Domain).run();
            if (widgetTheme !== undefined) await env.db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('widget_theme', ?)").bind(widgetTheme).run();
            if (faqList !== undefined) await env.db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('faq_list', ?)").bind(faqList).run();
            if (agentIcon !== undefined) await env.db.prepare("UPDATE config SET value = ? WHERE key = 'agent_icon'").bind(agentIcon).run();
            if (pcIconSize !== undefined) await env.db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('pc_icon_size', ?)").bind(pcIconSize).run();
            if (pcIconPos !== undefined) await env.db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('pc_icon_pos', ?)").bind(pcIconPos).run();
            if (mobileIconSize !== undefined) await env.db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('mobile_icon_size', ?)").bind(mobileIconSize).run();
            if (mobileIconPos !== undefined) await env.db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('mobile_icon_pos', ?)").bind(mobileIconPos).run();
            if (userIcon !== undefined) await env.db.prepare("UPDATE config SET value = ? WHERE key = 'user_icon'").bind(userIcon).run();
            if (autoReply !== undefined) await env.db.prepare("UPDATE config SET value = ? WHERE key = 'auto_reply'").bind(autoReply).run();
            if (quickReply !== undefined) await env.db.prepare("UPDATE config SET value = ? WHERE key = 'quick_reply'").bind(quickReply).run();
            if (username) await env.db.prepare("UPDATE config SET value = ? WHERE key = 'admin_username'").bind(username).run();
            if (password) await env.db.prepare("UPDATE config SET value = ? WHERE key = 'admin_password'").bind(password).run();
            if (botToken !== undefined) await env.db.prepare("UPDATE config SET value = ? WHERE key = 'tg_bot_token'").bind(botToken).run();
            if (chatId !== undefined) await env.db.prepare("UPDATE config SET value = ? WHERE key = 'tg_chat_id'").bind(chatId).run();
            return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          if (url.pathname === "/api/admin/users" && method === "GET") {
            const { results } = await env.db.prepare(`
              SELECT u.id, u.created_at, 
              (SELECT content FROM messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as last_message,
              (SELECT created_at FROM messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as last_time
              FROM users u ORDER BY last_time DESC
            `).all();
            return new Response(JSON.stringify({ users: results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          if (url.pathname === "/api/admin/messages" && method === "GET") {
            const userId = url.searchParams.get("userId");
            const { results } = await env.db.prepare("SELECT sender, content, created_at FROM messages WHERE user_id = ? ORDER BY created_at ASC").bind(userId).all();
            return new Response(JSON.stringify({ messages: results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          if (url.pathname === "/api/admin/reply" && method === "POST") {
            let { userId, content } = await request.json();
            let tgText = `[网页后台回复]:\n${content}`;

            // 新增逻辑：检查后台发送的是否为图片
            if (content.startsWith("data:image/")) {
                const base64Data = content.split(',')[1];
                const mimeType = content.split(';')[0].split(':')[1];
                const binaryStr = atob(base64Data);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                
                // 检查是否配置了 R2 并上传
                if (config.img_storage === 'r2' && env.r2) {
                    const fileName = `img_${Date.now()}_agent.png`;
                    await env.r2.put(fileName, bytes, { httpMetadata: { contentType: mimeType } });
                    const r2Domain = config.r2_domain ? config.r2_domain.replace(/\/$/, '') : '';
                    content = `IMG:${r2Domain}/${fileName}`;
                }
                tgText = `[网页后台回复了一张图片]`; // 避免把长串Base64代码发给TG导致卡顿
            }

            await env.db.prepare("INSERT INTO messages (user_id, sender, content) VALUES (?, 'agent', ?)").bind(userId, content).run();
            
            if (config.tg_bot_token && config.tg_chat_id) {
                const user = await env.db.prepare("SELECT tg_topic_id FROM users WHERE id = ?").bind(userId).first();
                if (user && user.tg_topic_id) {
                    await fetch(`https://api.telegram.org/bot${config.tg_bot_token}/sendMessage`, {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ chat_id: config.tg_chat_id, message_thread_id: user.tg_topic_id, text: tgText })
                    });
                }
            }
            return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          if (url.pathname === "/api/admin/export-messages" && method === "GET") {
            const { results } = await env.db.prepare("SELECT * FROM messages ORDER BY created_at ASC").all();
            return new Response(JSON.stringify(results), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          if (url.pathname === "/api/admin/import-config" && method === "POST") {
            const imported = await request.json();
            for (const [key, value] of Object.entries(imported)) {
                if(key !== 'admin_username' && key !== 'admin_password') {
                    await env.db.prepare("UPDATE config SET value = ? WHERE key = ?").bind(String(value), key).run();
                }
            }
            return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          if (url.pathname === "/api/admin/delete-user" && method === "POST") {
            const { userId } = await request.json();
            
            // 1. 获取用户的 TG Topic ID
            const user = await env.db.prepare("SELECT tg_topic_id FROM users WHERE id = ?").bind(userId).first();
            
            // 2. 如果存在 Topic ID 且配置了 TG 机器人，则调用 TG API 删除话题
            if (user && user.tg_topic_id && config.tg_bot_token && config.tg_chat_id) {
                await fetch(`https://api.telegram.org/bot${config.tg_bot_token}/deleteForumTopic`, {
                    method: "POST", 
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        chat_id: config.tg_chat_id, 
                        message_thread_id: user.tg_topic_id 
                    })
                }).catch(e => console.error("TG 删除失败:", e));
                
                // 清理 KV 缓存
                await env.kv.delete(`topic_${user.tg_topic_id}`);
            }

            // 3. 从数据库中彻底删除该用户及其聊天记录
            await env.db.prepare("DELETE FROM messages WHERE user_id = ?").bind(userId).run();
            await env.db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
            
            return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        } 

        /* ================= Customer API ================= */
        if (url.pathname === "/api/customer/config" && method === "GET") { return new Response(JSON.stringify({ agent_icon: config.agent_icon, user_icon: config.user_icon, faq_list: config.faq_list, pc_icon_size: config.pc_icon_size, pc_icon_pos: config.pc_icon_pos, mobile_icon_size: config.mobile_icon_size, mobile_icon_pos: config.mobile_icon_pos }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
        if (url.pathname === "/api/customer/send" && method === "POST") {
          let { userId, content } = await request.json();
          let topicId = null;
          let isNewUser = false;
          if (userId && !/^\d+$/.test(String(userId))) {
              userId = null;
          }
          // 核心逻辑：如果前端没有 userId，则由 D1 数据库分配一个自增的数字 ID
          if (!userId) {
              // 生成 100000 到 999999 之间的随机 6 位数字
              userId = Math.floor(100000 + Math.random() * 900000);
              // 显式将这个 6 位随机数字 ID 插入数据库
              await env.db.prepare("INSERT INTO users (id, tg_topic_id) VALUES (?, NULL)").bind(userId).run();
              isNewUser = true;
          } else {
              const user = await env.db.prepare("SELECT tg_topic_id FROM users WHERE id = ?").bind(userId).first();
              if (user) topicId = user.tg_topic_id;
          }

          if (config.tg_bot_token && config.tg_chat_id) {
              if (isNewUser) {
                  const topicRes = await fetch(`https://api.telegram.org/bot${config.tg_bot_token}/createForumTopic`, {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ chat_id: config.tg_chat_id, name: `访客_${userId}` })
                  }).then(r => r.json());

                  if (topicRes.ok) {
                      topicId = topicRes.result.message_thread_id;
                      await env.db.prepare("UPDATE users SET tg_topic_id = ? WHERE id = ?").bind(topicId, userId).run();
                      await env.kv.put(`topic_${topicId}`, userId.toString());
                  }
              }
              
              if (content.startsWith("data:image/")) {
                  const base64Data = content.split(',')[1];
                  const mimeType = content.split(';')[0].split(':')[1];
                  const binaryStr = atob(base64Data);
                  const bytes = new Uint8Array(binaryStr.length);
                  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                  
                  const formData = new FormData();
                  formData.append("chat_id", config.tg_chat_id);
                  if (topicId) formData.append("message_thread_id", topicId);
                  formData.append("photo", new Blob([bytes], { type: mimeType }), "image.png");
                  if (!topicId) formData.append("caption", `客户ID:${userId} 发来图片：`);
                  const tgRes = await fetch(`https://api.telegram.org/bot${config.tg_bot_token}/sendPhoto`, { method: "POST", body: formData }).then(r => r.json());
                  
                  let dbContent = content; // 默认 Base64
                  if (config.img_storage === 'tg' && tgRes.ok && tgRes.result.photo) {
                      const photoSize = tgRes.result.photo[tgRes.result.photo.length - 1];
                      dbContent = `IMG:/api/image?tg=${photoSize.file_id}`;
                  } else if (config.img_storage === 'r2' && env.r2) {
                      const fileName = `img_${Date.now()}_${userId}.png`;
                      await env.r2.put(fileName, bytes, { httpMetadata: { contentType: mimeType } });
                      const r2Domain = config.r2_domain ? config.r2_domain.replace(/\/$/, '') : '';
                      dbContent = `IMG:${r2Domain}/${fileName}`;
                  }
                  content = dbContent; // 更新存入数据库的真实内容
              } else {
                  let tgMsg = topicId ? content : `客户ID:${userId} 发来消息：\n${content}`;
                  await fetch(`https://api.telegram.org/bot${config.tg_bot_token}/sendMessage`, {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ chat_id: config.tg_chat_id, message_thread_id: topicId, text: tgMsg })
                  });
              }
          }

          await env.db.prepare("INSERT INTO messages (user_id, sender, content) VALUES (?, 'user', ?)").bind(userId, content).run();
          let faqAnswer = null;
          if (config.faq_list) {
              const lines = config.faq_list.split('\n');
              for (const line of lines) {
                  const parts = line.split('|');
                  if (parts.length >= 2 && parts[0].trim() === content.trim()) {
                      faqAnswer = parts.slice(1).join('|').trim();
                      break;
                  }
              }
          }

          if (faqAnswer) {
              await env.db.prepare("INSERT INTO messages (user_id, sender, content) VALUES (?, 'agent', ?)").bind(userId, faqAnswer).run();
              if (config.tg_bot_token && config.tg_chat_id && topicId) {
                  await fetch(`https://api.telegram.org/bot${config.tg_bot_token}/sendMessage`, {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ chat_id: config.tg_chat_id, message_thread_id: topicId, text: `[快捷回复]:\n${faqAnswer}` })
                  });
              }
          } else if (isNewUser && config.auto_reply) {
              await env.db.prepare("INSERT INTO messages (user_id, sender, content) VALUES (?, 'agent', ?)").bind(userId, config.auto_reply).run();
              if (config.tg_bot_token && config.tg_chat_id && topicId) {
                  await fetch(`https://api.telegram.org/bot${config.tg_bot_token}/sendMessage`, {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ chat_id: config.tg_chat_id, message_thread_id: topicId, text: `[系统自动回复]:\n${config.auto_reply}` })
                  });
              }
          }
          
          // 返回生成的 userId 给前端保存
          return new Response(JSON.stringify({ success: true, userId: userId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (url.pathname === "/api/customer/get-reply" && method === "GET") {
          const userId = url.searchParams.get("userId");
          if (!userId) return new Response("[]", { headers: corsHeaders });
          const { results } = await env.db.prepare("SELECT id, content, created_at FROM messages WHERE user_id = ? AND sender = 'agent' AND is_read = 0").bind(userId).all();
          if (results.length > 0) {
            const ids = results.map(r => r.id).join(",");
            await env.db.prepare(`UPDATE messages SET is_read = 1 WHERE id IN (${ids})`).run();
          }
          return new Response(JSON.stringify({ replies: results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (url.pathname === "/api/customer/history" && method === "GET") {
          const userId = url.searchParams.get("userId");
          if (!userId) return new Response(JSON.stringify({ history: [] }), { headers: corsHeaders });
          const { results } = await env.db.prepare("SELECT sender, content, created_at FROM messages WHERE user_id = ? ORDER BY created_at ASC").bind(userId).all();
          return new Response(JSON.stringify({ history: results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (url.pathname === "/api/image" && method === "GET") {
          const fileId = url.searchParams.get("tg");
          if (!fileId) return new Response("Missing ID", { status: 400, headers: corsHeaders });
          const fileRes = await fetch(`https://api.telegram.org/bot${config.tg_bot_token}/getFile?file_id=${fileId}`).then(r => r.json());
          if (fileRes.ok) {
             const imgRes = await fetch(`https://api.telegram.org/file/bot${config.tg_bot_token}/${fileRes.result.file_path}`);
             const headers = new Headers(imgRes.headers);
             headers.set("Access-Control-Allow-Origin", "*");
             return new Response(imgRes.body, { headers });
          }
          return new Response("Not found", { status: 404, headers: corsHeaders });
        }

        /* ================= TG Webhook ================= */
        if (url.pathname === "/tg/webhook" && method === "POST") {
          const update = await request.json();
          if (update.message && (update.message.text || update.message.photo)) {
            const text = update.message.text || update.message.caption || "";
            const threadId = update.message.message_thread_id;
            const replyTo = update.message.reply_to_message;
            
            let targetUserId = null;
            let replyContent = text;

            if (update.message.is_topic_message && threadId) {
              targetUserId = await env.kv.get(`topic_${threadId}`);
            } else if (replyTo && replyTo.text && replyTo.text.includes("客户ID:")) {
              const idMatch = replyTo.text.match(/客户ID:(\d+)/); // 正则改为只匹配纯数字
              if (idMatch) {
                targetUserId = idMatch[1];
                replyContent = text; 
              }
            } else {
              // 正则改为只匹配纯数字的 ID
              const matchAt = text.match(/^@ID:(\d+)\s+([\s\S]*)/);
              const matchBracket = text.match(/^【客户ID:(\d+)】([\s\S]*)/);

              if (matchAt) {
                targetUserId = matchAt[1];
                replyContent = matchAt[2];
              } else if (matchBracket) {
                targetUserId = matchBracket[1];
                replyContent = matchBracket[2];
              }
            }

            if (targetUserId) {
              if (update.message.photo) {
                const photoSize = update.message.photo[update.message.photo.length - 1];
                if (config.img_storage === 'tg') {
                  await env.db.prepare("INSERT INTO messages (user_id, sender, content) VALUES (?, 'agent', ?)").bind(targetUserId, `IMG:/api/image?tg=${photoSize.file_id}`).run();
                } else {
                  const fileRes = await fetch(`https://api.telegram.org/bot${config.tg_bot_token}/getFile?file_id=${photoSize.file_id}`).then(r => r.json());
                  if (fileRes.ok) {
                    const imgRes = await fetch(`https://api.telegram.org/file/bot${config.tg_bot_token}/${fileRes.result.file_path}`);
                    const arrayBuffer = await imgRes.arrayBuffer();
                    const mimeType = fileRes.result.file_path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                    if (config.img_storage === 'r2' && env.r2) {
                        const fileName = `img_${Date.now()}_agent.png`;
                        await env.r2.put(fileName, arrayBuffer, { httpMetadata: { contentType: mimeType } });
                        const r2Domain = config.r2_domain ? config.r2_domain.replace(/\/$/, '') : '';
                        await env.db.prepare("INSERT INTO messages (user_id, sender, content) VALUES (?, 'agent', ?)").bind(targetUserId, `IMG:${r2Domain}/${fileName}`).run();
                    } else {
                        let binary = '';
                        const bytes = new Uint8Array(arrayBuffer);
                        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                        await env.db.prepare("INSERT INTO messages (user_id, sender, content) VALUES (?, 'agent', ?)").bind(targetUserId, `data:${mimeType};base64,${btoa(binary)}`).run();
                    }
                  }
                }
              }
              if (replyContent && replyContent.trim() !== "") {
                await env.db.prepare("INSERT INTO messages (user_id, sender, content) VALUES (?, 'agent', ?)").bind(targetUserId, replyContent).run();
              }
            }
          }
          return new Response("OK", { status: 200 });
        }

        return new Response("Not Found", { status: 404, headers: corsHeaders });
      } catch (e) {
        return new Response(e.message, { status: 500, headers: corsHeaders });
      }
    }

      if (url.pathname === "/widget.js") {
        let theme = "widget";
        try {
          const themeObj = await env.db.prepare("SELECT value FROM config WHERE key = 'widget_theme'").first();
          if (themeObj && themeObj.value) theme = themeObj.value;
        } catch (e) {}
        return env.ASSETS.fetch(new Request(new URL(`/templates/${theme.toLowerCase()}.js`, request.url), request));
      }

      return env.ASSETS.fetch(request);
  }
};
