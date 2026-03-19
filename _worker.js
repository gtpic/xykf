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
            return new Response(JSON.stringify({ tg_bot_token: config.tg_bot_token, tg_chat_id: config.tg_chat_id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

        /* ================= Customer API ================= */
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
              const tgMsg = topicId ? content : `客户ID:${userId} 发来消息：\n${content}`;
              await fetch(`https://api.telegram.org/bot${config.tg_bot_token}/sendMessage`, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ chat_id: config.tg_chat_id, message_thread_id: topicId, text: tgMsg })
              });
          }

          await env.db.prepare("INSERT INTO messages (user_id, sender, content) VALUES (?, 'user', ?)").bind(userId, content).run();
          
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

        /* ================= TG Webhook ================= */
        if (url.pathname === "/tg/webhook" && method === "POST") {
          const update = await request.json();
          if (update.message && update.message.text) {
            const text = update.message.text;
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

            if (targetUserId && replyContent) {
              await env.db.prepare("INSERT INTO messages (user_id, sender, content) VALUES (?, 'agent', ?)").bind(targetUserId, replyContent).run();
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
