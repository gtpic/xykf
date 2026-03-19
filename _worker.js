export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    // 拦截 API 和 Webhook 请求
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

        /* ==========================================
           后台管理端 API
        ========================================== */
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
            return new Response(JSON.stringify({ 
              tg_bot_token: config.tg_bot_token, tg_chat_id: config.tg_chat_id 
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          if (url.pathname === "/api/admin/update-config" && method === "POST") {
            const { username, password, botToken, chatId } = await request.json();
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
            const { userId, content } = await request.json();
            await env.db.prepare("INSERT INTO messages (user_id, sender, content) VALUES (?, 'agent', ?)").bind(userId, content).run();
            if (config.tg_bot_token && config.tg_chat_id) {
                const user = await env.db.prepare("SELECT tg_topic_id FROM users WHERE id = ?").bind(userId).first();
                if (user && user.tg_topic_id) {
                    await fetch(`https://api.telegram.org/bot${config.tg_bot_token}/sendMessage`, {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ chat_id: config.tg_chat_id, message_thread_id: user.tg_topic_id, text: `[网页后台回复]:\n${content}` })
                    });
                }
            }
            return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        }

        /* ==========================================
           客户端与 TG Webhook API
        ========================================== */
        if (url.pathname === "/api/customer/send" && method === "POST") {
          const { userId, content } = await request.json();
          let user = await env.db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();
          let topicId = user ? user.tg_topic_id : null;

          if (config.tg_bot_token && config.tg_chat_id) {
              if (!user) {
                  const topicRes = await fetch(`https://api.telegram.org/bot${config.tg_bot_token}/createForumTopic`, {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ chat_id: config.tg_chat_id, name: `访客_${userId.substring(0, 6)}` })
                  }).then(r => r.json());

                  if (topicRes.ok) {
                      topicId = topicRes.result.message_thread_id;
                      await env.db.prepare("INSERT INTO users (id, tg_topic_id) VALUES (?, ?)").bind(userId, topicId).run();
                      await env.kv.put(`topic_${topicId}`, userId);
                  } else {
                      await env.db.prepare("INSERT INTO users (id) VALUES (?)").bind(userId).run();
                  }
              }
              const tgMsg = topicId ? content : `客户ID:${userId} 发来消息：\n${content}`;
              await fetch(`https://api.telegram.org/bot${config.tg_bot_token}/sendMessage`, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ chat_id: config.tg_chat_id, message_thread_id: topicId, text: tgMsg })
              });
          } else if (!user) {
              await env.db.prepare("INSERT INTO users (id) VALUES (?)").bind(userId).run();
          }

          await env.db.prepare("INSERT INTO messages (user_id, sender, content) VALUES (?, 'user', ?)").bind(userId, content).run();
          return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (url.pathname === "/api/customer/get-reply" && method === "GET") {
          const userId = url.searchParams.get("userId");
          const { results } = await env.db.prepare("SELECT id, content, created_at FROM messages WHERE user_id = ? AND sender = 'agent' AND is_read = 0").bind(userId).all();
          if (results.length > 0) {
            const ids = results.map(r => r.id).join(",");
            await env.db.prepare(`UPDATE messages SET is_read = 1 WHERE id IN (${ids})`).run();
          }
          return new Response(JSON.stringify({ replies: results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (url.pathname === "/api/customer/history" && method === "GET") {
          const userId = url.searchParams.get("userId");
          const { results } = await env.db.prepare("SELECT sender, content, created_at FROM messages WHERE user_id = ? ORDER BY created_at ASC").bind(userId).all();
          return new Response(JSON.stringify({ history: results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // ==========================================
        // 核心修改部分：TG Webhook
        // ==========================================
        if (url.pathname === "/tg/webhook" && method === "POST") {
          const update = await request.json();
          if (update.message && update.message.text) {
            const text = update.message.text;
            const threadId = update.message.message_thread_id;
            const replyTo = update.message.reply_to_message; // 获取被回复的原消息
            
            let targetUserId = null;
            let replyContent = text;

            // 模式 1：超级群组的自动话题 (Topic) 模式
            if (update.message.is_topic_message && threadId) {
              targetUserId = await env.kv.get(`topic_${threadId}`);
            } 
            
            // 模式 2：原生“右键回复”机器人的消息 (你截图里的需求 1)
            else if (replyTo && replyTo.text && replyTo.text.includes("客户ID:")) {
              const idMatch = replyTo.text.match(/客户ID:([a-zA-Z0-9_]+)/);
              if (idMatch) {
                targetUserId = idMatch[1];
                replyContent = text; // 当前发的文字就是回复内容
              }
            } 
            
            // 模式 3：使用艾特标签格式 (你截图里的需求 2)
            else {
              // 尝试匹配 @ID:u_xxxx 内容
              const matchAt = text.match(/^@ID:([a-zA-Z0-9_]+)\s+([\s\S]*)/);
              // 尝试匹配 【客户ID:u_xxxx】 内容 (保留之前的兼容性)
              const matchBracket = text.match(/^【客户ID:([a-zA-Z0-9_]+)】([\s\S]*)/);

              if (matchAt) {
                targetUserId = matchAt[1].trim();
                replyContent = matchAt[2].trim();
              } else if (matchBracket) {
                targetUserId = matchBracket[1].trim();
                replyContent = matchBracket[2].trim();
              }
            }

            // 如果成功匹配到了目标用户，写入数据库，等待客户轮询拉取
            if (targetUserId && replyContent) {
              await env.db.prepare("INSERT INTO messages (user_id, sender, content) VALUES (?, 'agent', ?)")
                .bind(targetUserId, replyContent).run();
            }
          }
          return new Response("OK", { status: 200 });
        }

        return new Response("Not Found", { status: 404, headers: corsHeaders });
      } catch (e) {
        return new Response(e.message, { status: 500, headers: corsHeaders });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
