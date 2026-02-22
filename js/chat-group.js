(function () {
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
      if (event && typeof event.filename === 'string' && event.filename.includes('extensionState.js')) {
        event.preventDefault();
      }
    });
  }
  let latestRenderedAt = 0;
  let latestOnlineUsers = [];
  let lastMessageSignature = '';
  let hasInitialScroll = false;
  let joined = false;
  let initialized = false;
  let userName = '';
  let userProvince = '';
  let groupChatUserInfo = null;
  let currentReplyData = null;
  let latestBannedUsers = [];
  let isAdminFilterEnabled = true;
  const isVipApp = typeof window !== 'undefined' && !!window.IS_VIP_APP;
  const adminEmailHashes = ['cGljaGZwdkBnbWFpbC5j', 'cmFqdS5zYW5nbWVycGF0'];
  const userColors = {};
  const colorPalette = [
    {solid: '#f97316', soft: '#ffedd5'},
    {solid: '#eab308', soft: '#fef9c3'},
    {solid: '#84cc16', soft: '#f0fdf4'},
    {solid: '#14b8a6', soft: '#f0fdfa'},
    {solid: '#06b6d4', soft: '#ecfeff'},
    {solid: '#3b82f6', soft: '#dbeafe'},
    {solid: '#8b5cf6', soft: '#f5f3ff'},
    {solid: '#d946ef', soft: '#fae8ff'},
    {solid: '#ec4899', soft: '#fce7f3'},
    {solid: '#64748b', soft: '#f1f5f9'},
  ];
  const adminColor = {solid: '#ef4444', soft: '#fee2e2'};
  let newChatSound = null;
  try {
    if (typeof Howl !== 'undefined') {
      newChatSound = new Howl({
        src: ['https://cdn.jsdelivr.net/gh/syifarahmat/sulap.foto@a14c6c/assets/newchat.mp3'],
        volume: 1,
        preload: true
      });
    }
  } catch (e) {
  }

  function isLoggedIn() {
    return !!localStorage.getItem('sulapfoto_verified_email');
  }

  const chatProfileStorageKey = 'sulapfoto_chat_profile';

  function getStoredChatProfile() {
    try {
      const raw = localStorage.getItem(chatProfileStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const username = typeof parsed.username === 'string' ? parsed.username.trim() : '';
      const province = typeof parsed.province === 'string' ? parsed.province.trim() : '';
      if (!username) return null;
      return {username, province};
    } catch (e) {
      return null;
    }
  }

  function setStoredChatProfile(profile) {
    try {
      if (!profile || typeof profile !== 'object') return;
      const username = typeof profile.username === 'string' ? profile.username.trim() : '';
      const province = typeof profile.province === 'string' ? profile.province.trim() : '';
      if (!username) return;
      localStorage.setItem(chatProfileStorageKey, JSON.stringify({username, province}));
    } catch (e) {
    }
  }

  function clearStoredChatProfile() {
    try {
      localStorage.removeItem(chatProfileStorageKey);
    } catch (e) {
    }
  }

  function encodeEmail(email) {
    try {
      const encoded = btoa(String(email || '').toLowerCase());
      return encoded.replace(/[+/=]/g, '').substring(0, 20);
    } catch (e) {
      return '';
    }
  }

  function isAdminEmail(email) {
    const hash = encodeEmail(email);
    return adminEmailHashes.some(adminHash => adminHash === hash);
  }

  function maskEmail(email) {
    if (!email || typeof email !== 'string' || !email.includes('@')) return '***@***.***';
    const parts = email.split('@');
    if (parts.length !== 2) return '***@***.***';
    const localPart = parts[0];
    const domain = parts[1];
    if (localPart.length <= 4) {
      return localPart.charAt(0) + '*'.repeat(Math.max(1, localPart.length - 1)) + '@' + domain;
    }
    return localPart.slice(0, 2) + '*'.repeat(localPart.length - 4) + localPart.slice(-2) + '@' + domain;
  }

  function getUserColor(name, province, isAdmin) {
    if (isAdmin) return adminColor;
    const userKey = `${name}-${province}`;
    if (userColors[userKey]) return userColors[userKey];
    let hash = 0;
    for (let i = 0; i < userKey.length; i++) {
      hash = userKey.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colorIndex = Math.abs(hash % colorPalette.length);
    const color = colorPalette[colorIndex];
    userColors[userKey] = color;
    return color;
  }

  function formatTime(ts) {
    try {
      const d = new Date(ts * 1000);
      const hh = d.getHours().toString().padStart(2, '0');
      const mm = d.getMinutes().toString().padStart(2, '0');
      return hh + ':' + mm;
    } catch (e) {
      return '';
    }
  }

  function appendSystemBubble(message, icon, color) {
    const container = document.getElementById('group-chat-history');
    if (!container) return;
    const bubble = document.createElement('div');
    bubble.className = 'group-chat-bubble';
    bubble.style.backgroundColor = color || '#fee2e2';
    bubble.style.color = '#b91c1c';
    bubble.style.alignSelf = 'center';
    bubble.style.fontSize = '0.75rem';
    bubble.style.width = 'fit-content';
    bubble.style.margin = '0.5rem auto';
    bubble.style.padding = '0.5rem 1rem';
    bubble.style.border = '1px solid #fecaca';
    bubble.innerHTML = `<div class="flex items-center gap-2"><i data-lucide="${icon || 'alert-circle'}" class="w-4 h-4"></i> <span>${message}</span></div>`;
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  async function moderateChatMessage(text) {
    let shouldSend = true;
    let errorMessage = '';
    let cleanedText = text;
    try {
      const formData = new FormData();
      formData.append('prompt', `Moderation task. Analyze this Indonesian chat message: "${text}".
Check for these conditions:
1. Does it contain any URL, link, domain name, or request to visit a site?
2. Does it contain severe rudeness, hate speech, or sexual content?
3. Does it contain disparaging, insulting, or negative accusations (e.g., "fraudster", "dick", "trash") specifically targeting the app "Sulap Foto" or "Sufo"?
4. Does it contain spam, excessive repetition of characters without meaning (e.g., "aaaaa", "wkwkwkwkwk" if excessive), or random gibberish?
5. Does it contain the words "grok" or "meta" in any form, including obfuscated variations (e.g., gr0k, g120k, m3ta, m3t4, etc)?

If ANY of conditions 1-5 are met, respond ONLY with "BLOCK".
If the message contains a very rude or rude complaint, rewrite it to be polite and friendly. Respond with Only "TRANSFORM: <polite_message>"
If the message is safe, clean, polite, and constructive, respond ONLY with "SAFE".`);
      const chatUrl = (typeof CHAT_URL !== 'undefined' && CHAT_URL) ? CHAT_URL : '/server/chat.php';
      const headers = {};
      if (typeof API_KEY !== 'undefined' && API_KEY) {
        headers['X-API-Key'] = API_KEY;
      }
      const response = await fetch(chatUrl, {
        method: 'POST',
        cache: 'no-store',
        headers,
        body: formData
      });
      if (!response.ok) {
        if (response.status >= 500) {
          shouldSend = false;
          errorMessage = 'Pesan gagal diproses. Coba lagi.';
        }
        return {shouldSend, errorMessage, text: cleanedText};
      }
      const result = await response.json();
      const errorText = typeof result?.error === 'string'
        ? result.error
        : (typeof result?.error?.message === 'string' ? result.error.message : (typeof result?.message === 'string' ? result.message : ''));
      const analysis = (result.success && result.response ? result.response : (result.response || result.candidates?.[0]?.content?.parts?.[0]?.text || '')).trim();
      if (errorText) {
        shouldSend = false;
        errorMessage = 'Pesan gagal diproses. Coba lagi.';
      } else if (!analysis) {
        shouldSend = false;
        errorMessage = 'Pesan gagal diproses. Coba lagi.';
      } else if (analysis.includes('BLOCK')) {
        shouldSend = false;
        errorMessage = 'Pesan Anda mengandung konten yang tidak diizinkan (Link, Kasar, Spam).';
      } else if (analysis.includes('TRANSFORM:')) {
        cleanedText = analysis.replace('TRANSFORM:', '').trim();
      }
    } catch (e) {
    }
    return {shouldSend, errorMessage, text: cleanedText};
  }

  function getCurrentUserInfo() {
    if (!userName || !userProvince) return null;
    const email = localStorage.getItem('sulapfoto_verified_email') || '';
    const isAdmin = isAdminEmail(email);
    const isVip = isVipApp && !isAdmin;
    return {name: userName, province: userProvince, isAdmin, isVip};
  }

  function notifyChatProfile() {
    const username = userName ? userName.trim() : '';
    const province = userProvince ? userProvince.trim() : '';
    if (!username) return;
    try {
      window.dispatchEvent(new CustomEvent('chat:profile-selected', {
        detail: {
          username,
          province
        }
      }));
    } catch (e) {
    }
  }

  function buildWelcomeHtml(userInfo) {
    if (!userInfo) return 'Silahkan masuk untuk mulai berdiskusi.';
    const userColor = getUserColor(userInfo.name, userInfo.province, userInfo.isAdmin);
    let welcomeHTML = `Masuk sebagai: <strong style="color: ${userColor.solid}; margin-left: 5px;">${userInfo.name}`;
    if (userInfo.isVip && !userInfo.isAdmin) {
      welcomeHTML += `&nbsp;<span style="background: linear-gradient(to top right, #f59e0b, #fde047); color: #78350f; font-size: 9px; padding: 2px 5px; border-radius: 5px; font-weight: bold; box-shadow: 0 0 6px rgba(251,191,36,0.4); border: 1px solid rgba(253,224,71,0.3);">VIP</span>`;
    }
    if (userInfo.isAdmin) {
      welcomeHTML += `&nbsp;<span style="background-color: ${userColor.solid}; color: white; font-size: 9px; padding: 2px 5px; border-radius: 5px; font-weight: bold;">ADMIN</span>`;
    } else {
      welcomeHTML += ` (${userInfo.province})`;
    }
    welcomeHTML += `</strong>`;
    return welcomeHTML;
  }

  function buildMessageSignature(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return 'empty';
    const count = messages.length;
    const first = messages[0] || {};
    const last = messages[count - 1] || {};
    const headId = first.id || first.message_id || '';
    const tailId = last.id || last.message_id || '';
    const headTs = first.created_at || 0;
    const tailTs = last.created_at || 0;
    return `${count}:${headId}:${tailId}:${headTs}:${tailTs}`;
  }

  function scrollGroupChatToBottom() {
    const container = document.getElementById('group-chat-history');
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    hasInitialScroll = true;
  }

  function renderMessages(messages) {
    const container = document.getElementById('group-chat-history');
    if (!container || !Array.isArray(messages)) return;
    const signature = buildMessageSignature(messages);
    if (signature && signature === lastMessageSignature) return;
    lastMessageSignature = signature;
    container.innerHTML = '';
    let maxTs = latestRenderedAt;
    messages.slice().reverse().forEach(item => {
      const messageId = item.id || item.message_id || '';
      const text = item.message || '';
      const ts = item.created_at || 0;
      const userInfo = {
        name: item.username || item.email || '***@***.***',
        province: item.province || '',
        isVip: !!item.is_vip,
        isAdmin: !!item.is_admin
      };
      const isMe = groupChatUserInfo
        ? (userInfo.isAdmin
          ? userInfo.name === groupChatUserInfo.name
          : (userInfo.name === groupChatUserInfo.name && userInfo.province === groupChatUserInfo.province))
        : false;
      const bubble = document.createElement('div');
      if (messageId) bubble.id = `msg-${messageId}`;
      const userColor = getUserColor(userInfo.name, userInfo.province, userInfo.isAdmin);
      const bubbleBgColor = isMe ? 'var(--accent)' : userColor.soft;
      const textColor = isMe ? 'white' : 'var(--text-dark)';
      const usernameColor = isMe ? '#f0fdfa' : userColor.solid;
      bubble.className = `group-chat-bubble group ${isMe ? 'me' : 'other'}`;
      bubble.style.backgroundColor = bubbleBgColor;
      bubble.style.color = textColor;
      const sanitizedText = String(text).replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      let displayName = isMe ? 'Anda' : userInfo.name;
      if (!isMe && !userInfo.isAdmin && userInfo.province) {
        displayName += ` (${userInfo.province})`;
      }
      let usernameHTML = `<span class="username" style="color: ${usernameColor};">${displayName}</span>`;
      if (userInfo.isVip && !userInfo.isAdmin) {
        usernameHTML += `&nbsp;<span style="background: linear-gradient(to top right, #f59e0b, #fde047); color: #78350f; font-size: 8px; padding: 1px 5px; border-radius: 4px; font-weight: bold; vertical-align: middle; box-shadow: 0 0 6px rgba(251,191,36,0.4); border: 1px solid rgba(253,224,71,0.3);">VIP</span>`;
      }
      if (userInfo.isAdmin && !isMe) {
        usernameHTML += `&nbsp;<span style="background-color: ${userColor.solid}; color: white; font-size: 8px; padding: 1px 4px; border-radius: 4px; font-weight: bold; vertical-align: middle;">ADMIN</span>`;
      }
      const actions = [];
      if (!isMe) {
        actions.push(`
                    <button type="button" class="reply-btn reply-btn-modern"
                        data-message-id="${messageId}"
                        data-message-user="${userInfo.name}"
                        data-message-text="${sanitizedText.substring(0, 100)}">
                        <i data-lucide="reply" class="w-3.5 h-3.5 pointer-events-none"></i>
                        <span>Balas</span>
                    </button>
                `);
      }
      if (isMe) {
        actions.push(`
                    <button type="button" class="self-delete-btn reply-btn-modern"
                        data-message-id="${messageId}">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5 pointer-events-none"></i>
                        <span>Hapus</span>
                    </button>
                `);
      }
      if (groupChatUserInfo && groupChatUserInfo.isAdmin && !isMe) {
        actions.push(`
                    <button type="button" class="admin-delete-btn reply-btn-modern"
                        data-message-id="${messageId}">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5 pointer-events-none"></i>
                        <span>Hapus</span>
                    </button>
                `);
        actions.push(`
                    <button type="button" class="admin-ban-btn reply-btn-modern"
                        data-message-id="${messageId}">
                        <i data-lucide="ban" class="w-3.5 h-3.5 pointer-events-none"></i>
                        <span>Ban</span>
                    </button>
                `);
      }
      const actionsHTML = actions.length
        ? `<div class="flex items-center gap-2 mt-2 justify-end">${actions.join('')}</div>`
        : '';
      let replyQuoteHTML = '';
      if (item.reply_to && item.reply_to.user && item.reply_to.text) {
        const replyTextPreview = item.reply_to.text.length > 50 ? item.reply_to.text.substring(0, 50) + '...' : item.reply_to.text;
        const replyTargetId = item.reply_to.messageId || '';
        replyQuoteHTML = `
                    <div class="reply-quote" data-reply-message-id="${replyTargetId}">
                        <div class="reply-quote-user">${item.reply_to.user}</div>
                        <span class="reply-quote-text">${replyTextPreview.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>
                    </div>`;
      }
      bubble.innerHTML = `
                <div class="flex justify-between items-center mb-1">
                    <div class="flex items-center">${usernameHTML}</div>
                    <span class="text-xs opacity-60 flex-shrink-0 pl-2">${formatTime(ts)}</span>
                </div>
                ${replyQuoteHTML}
                <div class="mt-1">
                    <span class="flex-grow min-w-0">${sanitizedText.replace(/\n/g, '<br>')}</span>
                </div>
                ${actionsHTML}
            `;
      container.appendChild(bubble);
      if (ts > maxTs) maxTs = ts;
    });
    if (maxTs > latestRenderedAt) {
      latestRenderedAt = maxTs;
      if (newChatSound && typeof newChatSound.play === 'function') {
        try {
          newChatSound.play();
        } catch (e) {
        }
      }
    }
    try {
      container.scrollTop = container.scrollHeight;
      hasInitialScroll = true;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
    }
  }

  async function sendChatAction(type, messageId, target) {
    const email = localStorage.getItem('sulapfoto_verified_email') || '';
    const deviceId = localStorage.getItem('sulapfoto_device_id') || '';
    if (!email || !deviceId) return;
    if (type !== 'unban' && !messageId) return;
    if (type === 'unban' && !((target && target.email) || (target && target.deviceId))) return;
    try {
      const actionPayload = {
        type
      };
      if (type === 'unban') {
        actionPayload.email = target && target.email ? target.email : '';
        actionPayload.device_id = target && target.deviceId ? target.deviceId : '';
      } else {
        actionPayload.message_id = messageId;
      }
      const response = await fetch('/server/proxy.php?config=true', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          device_id: deviceId,
          chat_action: actionPayload
        })
      });
      if (!response.ok) {
        appendSystemBubble('Aksi gagal diproses.', 'alert-circle');
        return;
      }
      if (type === 'unban') {
        const targetEmail = target && target.email ? target.email : '';
        const targetDevice = target && target.deviceId ? target.deviceId : '';
        latestBannedUsers = latestBannedUsers.filter(item => {
          const emailMatch = targetEmail && (item.email || '') === targetEmail;
          const deviceMatch = targetDevice && (item.device_id || '') === targetDevice;
          return !(emailMatch || deviceMatch);
        });
        populateBannedUsersModal();
        appendSystemBubble('Pengguna berhasil di-unban.', 'shield');
        return;
      }
      const targetEl = document.getElementById(`msg-${messageId}`);
      if (targetEl) {
        targetEl.remove();
      }
      appendSystemBubble(type === 'ban' ? 'Pengguna diblokir.' : 'Pesan dihapus.', 'shield');
    } catch (e) {
      appendSystemBubble('Aksi gagal diproses.', 'alert-circle');
    }
  }

  function updateOnline(count, users) {
    const countEl = document.getElementById('online-count');
    if (countEl) countEl.textContent = String(count || 0);
    latestOnlineUsers = Array.isArray(users) ? users : [];
  }

  function updateBanned(users) {
    latestBannedUsers = Array.isArray(users) ? users : [];
    const bannedBtn = document.getElementById('banned-users-list-btn');
    const shouldShow = !!(groupChatUserInfo && groupChatUserInfo.isAdmin);
    if (bannedBtn) {
      if (shouldShow) {
        bannedBtn.classList.remove('hidden');
      } else {
        bannedBtn.classList.add('hidden');
      }
    }
  }

  function populateOnlineUsersModal() {
    const listEl = document.getElementById('online-users-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!latestOnlineUsers.length) {
      listEl.innerHTML = '<p class="text-center text-sm text-gray-500 py-4">Tidak ada data pengguna online.</p>';
      return;
    }
    latestOnlineUsers.forEach(u => {
      const item = document.createElement('div');
      item.className = 'online-user-item';
      const avatar = document.createElement('div');
      avatar.className = 'online-user-avatar';
      const initial = (u.email || 'U')[0].toUpperCase();
      avatar.textContent = initial;
      const info = document.createElement('div');
      info.className = 'online-user-info';
      const name = document.createElement('div');
      name.className = 'online-user-name';
      const nameText = document.createElement('span');
      nameText.className = 'online-user-name-text';
      nameText.textContent = u.email || '***@***.***';
      name.appendChild(nameText);
      if (u.is_vip) {
        const badge = document.createElement('span');
        badge.className = 'online-user-badge vip';
        badge.textContent = 'VIP';
        name.appendChild(badge);
      }
      const tags = document.createElement('div');
      tags.className = 'online-user-tags';
      const username = typeof u.username === 'string' ? u.username.trim() : '';
      const province = typeof u.province === 'string' ? u.province.trim() : '';
      if (username) {
        const tag = document.createElement('span');
        tag.className = 'online-user-tag';
        tag.textContent = username;
        tags.appendChild(tag);
      }
      if (province) {
        const tag = document.createElement('span');
        tag.className = 'online-user-tag secondary';
        tag.textContent = province;
        tags.appendChild(tag);
      }
      info.appendChild(name);
      if (tags.childNodes.length > 0) {
        info.appendChild(tags);
      }
      const status = document.createElement('div');
      status.className = 'online-user-status';
      item.appendChild(avatar);
      item.appendChild(info);
      item.appendChild(status);
      listEl.appendChild(item);
    });
  }

  function populateBannedUsersModal() {
    const listEl = document.getElementById('banned-users-list');
    if (!listEl) return;
    if (!latestBannedUsers.length) {
      listEl.innerHTML = '<p class="text-center text-sm text-gray-500 py-4">Tidak ada pengguna dibanned.</p>';
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'divide-y divide-slate-200';
    latestBannedUsers.forEach(u => {
      const email = typeof u.email === 'string' ? u.email : '';
      const deviceId = typeof u.device_id === 'string' ? u.device_id : '';
      const display = email ? maskEmail(email) : (deviceId ? `Device ${deviceId.slice(0, 8)}...` : 'Pengguna');
      const li = document.createElement('li');
      li.className = 'p-2 text-sm text-slate-700 flex items-center justify-between gap-2';
      const label = document.createElement('span');
      label.className = 'truncate';
      label.textContent = display;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'admin-unban-btn reply-btn-modern';
      btn.setAttribute('data-email', email);
      btn.setAttribute('data-device-id', deviceId);
      btn.innerHTML = `
                <i data-lucide="shield-check" class="w-3.5 h-3.5 pointer-events-none"></i>
                <span>Unban</span>
            `;
      li.appendChild(label);
      li.appendChild(btn);
      ul.appendChild(li);
    });
    listEl.innerHTML = '';
    listEl.appendChild(ul);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function setChatEntryState(isJoined) {
    const groupChatHistory = document.getElementById('group-chat-history');
    const groupChatInput = document.getElementById('group-chat-input');
    const groupChatSendBtn = document.getElementById('group-chat-send-btn');
    const groupChatJoinBtn = document.getElementById('group-chat-join-btn');
    const replyPreviewContainer = document.getElementById('reply-preview-container');
    if (groupChatHistory) {
      groupChatHistory.classList.toggle('group-chat-history-blurred', !isJoined);
    }
    if (groupChatInput) {
      groupChatInput.disabled = !isJoined;
      groupChatInput.placeholder = isJoined ? 'Ketik pesan...' : 'Silahkan masuk untuk mulai berdiskusi...';
      groupChatInput.classList.toggle('hidden', !isJoined);
    }
    if (groupChatSendBtn) {
      groupChatSendBtn.disabled = !isJoined;
      groupChatSendBtn.classList.toggle('hidden', !isJoined);
    }
    if (groupChatJoinBtn) {
      groupChatJoinBtn.classList.toggle('hidden', isJoined);
    }
    updateFilterToggleState(isJoined);
    if (!isJoined && replyPreviewContainer) {
      replyPreviewContainer.classList.remove('active');
    }
  }

  function updateFilterToggleState(isJoined) {
    const filterToggleWrap = document.getElementById('group-chat-filter-toggle-wrap');
    const filterToggleInput = document.getElementById('group-chat-filter-toggle');
    if (!filterToggleWrap || !filterToggleInput) return;
    const isAdmin = !!groupChatUserInfo?.isAdmin;
    const isVisible = !!isJoined && isAdmin;
    filterToggleWrap.classList.toggle('hidden', !isVisible);
    if (isVisible) {
      filterToggleInput.checked = !!isAdminFilterEnabled;
    }
  }

  window.autoLogoutGroupChat = function () {
    const nameEntry = document.getElementById('group-chat-name-entry');
    const ui = document.getElementById('group-chat-interface');
    const input = document.getElementById('group-chat-input');
    const welcomeEl = document.getElementById('group-chat-welcome-user');
    const replyPreviewContainer = document.getElementById('reply-preview-container');
    joined = false;
    groupChatUserInfo = null;
    currentReplyData = null;
    isAdminFilterEnabled = true;
    clearStoredChatProfile();
    if (ui) ui.classList.remove('hidden');
    if (nameEntry) nameEntry.classList.add('hidden');
    if (input) input.value = '';
    if (replyPreviewContainer) replyPreviewContainer.classList.remove('active');
    if (welcomeEl) welcomeEl.textContent = 'Silahkan masuk untuk mulai berdiskusi.';
    setChatEntryState(false);
  };

  function applyAutoJoin(profile) {
    if (joined) return;
    const nameVal = (profile && profile.username ? profile.username : '').trim();
    const provVal = (profile && profile.province ? profile.province : '').trim();
    if (!nameVal) return;
    const email = localStorage.getItem('sulapfoto_verified_email') || '';
    const isAdmin = isAdminEmail(email);
    if (!isAdmin && !provVal) return;
    userName = nameVal;
    userProvince = isAdmin ? '' : provVal;
    joined = true;
    groupChatUserInfo = {name: userName, province: userProvince, isAdmin, isVip: isVipApp && !isAdmin};
    isAdminFilterEnabled = true;
    const nameEntry = document.getElementById('group-chat-name-entry');
    const ui = document.getElementById('group-chat-interface');
    const welcomeEl = document.getElementById('group-chat-welcome-user');
    if (nameEntry) nameEntry.classList.add('hidden');
    if (ui) ui.classList.remove('hidden');
    if (welcomeEl && groupChatUserInfo) welcomeEl.innerHTML = buildWelcomeHtml(groupChatUserInfo);
    if (typeof updateBanned === 'function') updateBanned(latestBannedUsers);
    setChatEntryState(true);
    setStoredChatProfile({username: userName, province: userProvince});
    notifyChatProfile();
    try {
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
    }
    setTimeout(() => {
      scrollGroupChatToBottom();
    }, 150);
  }

  function init() {
    if (initialized) return;
    initialized = true;
    const nameEntry = document.getElementById('group-chat-name-entry');
    const ui = document.getElementById('group-chat-interface');
    const nameForm = document.getElementById('group-chat-name-form');
    const nameInput = document.getElementById('group-chat-name-input');
    const provinceInput = document.getElementById('group-chat-province-input');
    const nameValidationError = document.getElementById('name-validation-error');
    const welcomeEl = document.getElementById('group-chat-welcome-user');
    const logoutBtn = document.getElementById('group-chat-logout-btn');
    const chatForm = document.getElementById('group-chat-form');
    const chatInput = document.getElementById('group-chat-input');
    const chatSendBtn = document.getElementById('group-chat-send-btn');
    const chatJoinBtn = document.getElementById('group-chat-join-btn');
    const onlineBtn = document.getElementById('online-users-list-btn');
    const onlineModal = document.getElementById('online-users-modal');
    const onlineModalClose = document.getElementById('online-users-modal-close');
    const bannedBtn = document.getElementById('banned-users-list-btn');
    const bannedModal = document.getElementById('banned-users-modal');
    const bannedModalClose = document.getElementById('banned-users-modal-close');
    const bannedList = document.getElementById('banned-users-list');
    const groupChatHistory = document.getElementById('group-chat-history');
    const replyPreviewContainer = document.getElementById('reply-preview-container');
    const replyPreviewUser = document.getElementById('reply-preview-user');
    const replyPreviewText = document.getElementById('reply-preview-text');
    const replyPreviewClose = document.getElementById('reply-preview-close');
    const filterToggleInput = document.getElementById('group-chat-filter-toggle');
    if (!nameEntry || !ui) return;
    if (nameEntry) nameEntry.classList.add('hidden');
    if (ui) ui.classList.remove('hidden');
    if (welcomeEl) welcomeEl.textContent = 'Silahkan masuk untuk mulai berdiskusi.';
    updateBanned([]);
    setChatEntryState(false);
    updateFilterToggleState(false);
    if (provinceInput) {
      const provinces = ["Aceh", "Bali", "Banten", "Bengkulu", "DI Yogyakarta", "DKI Jakarta", "Gorontalo", "Jambi", "Jawa Barat", "Jawa Tengah", "Jawa Timur", "Kalimantan Barat", "Kalimantan Selatan", "Kalimantan Tengah", "Kalimantan Timur", "Kalimantan Utara", "Kep. Bangka Belitung", "Kep. Riau", "Lampung", "Maluku", "Maluku Utara", "Nusa Tenggara Barat", "Nusa Tenggara Timur", "Papua", "Papua Barat", "Riau", "Sulawesi Barat", "Sulawesi Selatan", "Sulawesi Tengah", "Sulawesi Tenggara", "Sulawesi Utara", "Sumatera Barat", "Sumatera Selatan", "Sumatera Utara"];
      if (provinceInput.options.length <= 1) {
        provinces.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p;
          opt.textContent = p;
          provinceInput.appendChild(opt);
        });
      }
    }
    if (nameForm) {
      nameForm.addEventListener('submit', (e) => {
        e.preventDefault();
        let nameVal = (nameInput && nameInput.value || '').trim();
        let provVal = (provinceInput && provinceInput.value || '').trim();
        const currentEmail = localStorage.getItem('sulapfoto_verified_email') || '';
        const isAdmin = isAdminEmail(currentEmail);
        if (nameValidationError) nameValidationError.textContent = '';
        if (!nameVal) return;
        if (nameVal.length < 3) {
          if (nameValidationError) nameValidationError.textContent = 'Username minimal 3 karakter.';
          return;
        }
        if (/\s/.test(nameVal)) {
          if (nameValidationError) nameValidationError.textContent = 'Username tidak boleh mengandung spasi.';
          return;
        }
        if (/@/.test(nameVal)) {
          if (nameValidationError) nameValidationError.textContent = 'Username tidak boleh berupa email. Gunakan nama unik.';
          return;
        }
        const lowerName = nameVal.toLowerCase();
        if ((lowerName === 'Raju' || lowerName === 'IchsanLabs') && !isAdmin) {
          if (nameValidationError) nameValidationError.textContent = 'Username ini khusus untuk admin.';
          return;
        }
        if (!isAdmin) {
          if (!provVal) {
            if (nameValidationError) nameValidationError.textContent = 'Silakan pilih provinsi Anda.';
            return;
          }
        } else {
          provVal = '';
        }
        userName = lowerName === 'raju' ? 'Raju' : nameVal;
        userProvince = provVal;
        joined = true;
        groupChatUserInfo = {name: userName, province: userProvince, isAdmin, isVip: isVipApp && !isAdmin};
        nameEntry.classList.add('hidden');
        ui.classList.remove('hidden');
        if (welcomeEl) welcomeEl.innerHTML = buildWelcomeHtml(groupChatUserInfo);
        updateBanned(latestBannedUsers);
        isAdminFilterEnabled = true;
        setChatEntryState(true);
        setStoredChatProfile({username: userName, province: userProvince});
        notifyChatProfile();
        try {
          if (typeof lucide !== 'undefined') lucide.createIcons();
        } catch (e) {
        }
      });
    }
    if (filterToggleInput) {
      filterToggleInput.addEventListener('change', () => {
        isAdminFilterEnabled = !!filterToggleInput.checked;
      });
    }
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        userName = '';
        userProvince = '';
        window.autoLogoutGroupChat();
      });
    }
    if (chatJoinBtn) {
      chatJoinBtn.addEventListener('click', () => {
        if (nameEntry) nameEntry.classList.remove('hidden');
        if (nameInput && userName) {
          nameInput.value = userName;
        }
        if (provinceInput && userProvince) {
          provinceInput.value = userProvince;
        }
        if (nameInput) nameInput.focus();
      });
    }
    if (chatForm && chatInput) {
      chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        let text = chatInput.value.trim();
        if (!text) return;
        if (!isLoggedIn()) {
          chatInput.value = '';
          return;
        }
        if (!joined || !groupChatUserInfo) {
          chatInput.value = '';
          return;
        }
        if (!navigator.onLine) {
          appendSystemBubble('Anda sedang offline. Periksa koneksi internet Anda.', 'wifi-off');
          return;
        }
        if (chatSendBtn) {
          chatSendBtn.disabled = true;
          chatSendBtn.innerHTML = '<div class="loader-icon w-4 h-4 rounded-full"></div>';
        }
        let moderation = {shouldSend: true, text};
        const shouldModerate = !groupChatUserInfo.isAdmin || isAdminFilterEnabled;
        if (shouldModerate) {
          moderation = await moderateChatMessage(text);
          if (!moderation.shouldSend) {
            appendSystemBubble(moderation.errorMessage || 'Gagal mengirim pesan.', 'alert-circle');
            if (chatSendBtn) {
              chatSendBtn.disabled = false;
              chatSendBtn.innerHTML = '<i data-lucide="send" class="w-5 h-5"></i>';
              if (typeof lucide !== 'undefined') lucide.createIcons();
            }
            return;
          }
          text = moderation.text || text;
        }
        const payload = {
          text,
          user: groupChatUserInfo.name,
          province: groupChatUserInfo.province,
          isVip: !!groupChatUserInfo.isVip,
          isAdmin: !!groupChatUserInfo.isAdmin,
          replyTo: currentReplyData ? {
            messageId: currentReplyData.messageId,
            user: currentReplyData.user,
            text: currentReplyData.text
          } : null
        };
        window.queueChatMessage(payload);
        chatInput.value = '';
        currentReplyData = null;
        if (replyPreviewContainer) replyPreviewContainer.classList.remove('active');
        if (chatSendBtn) {
          chatSendBtn.disabled = false;
          chatSendBtn.innerHTML = '<i data-lucide="send" class="w-5 h-5"></i>';
          if (typeof lucide !== 'undefined') lucide.createIcons();
        }
      });
    }
    if (groupChatHistory) {
      groupChatHistory.addEventListener('click', (e) => {
        const adminDeleteBtn = e.target.closest('.admin-delete-btn');
        const adminBanBtn = e.target.closest('.admin-ban-btn');
        const selfDeleteBtn = e.target.closest('.self-delete-btn');
        const replyBtn = e.target.closest('.reply-btn');
        const replyQuote = e.target.closest('.reply-quote');
        if (adminDeleteBtn) {
          const messageId = adminDeleteBtn.getAttribute('data-message-id');
          if (messageId && window.confirm('Hapus pesan ini?')) {
            sendChatAction('delete', messageId);
          }
          return;
        }
        if (adminBanBtn) {
          const messageId = adminBanBtn.getAttribute('data-message-id');
          if (messageId && window.confirm('Ban pengguna ini?')) {
            sendChatAction('ban', messageId);
          }
          return;
        }
        if (selfDeleteBtn) {
          const messageId = selfDeleteBtn.getAttribute('data-message-id');
          if (messageId && window.confirm('Hapus pesan ini?')) {
            sendChatAction('delete', messageId);
          }
          return;
        }
        if (replyQuote) {
          const replyTargetId = replyQuote.getAttribute('data-reply-message-id');
          if (replyTargetId) {
            const targetEl = document.getElementById(`msg-${replyTargetId}`);
            if (targetEl) {
              targetEl.scrollIntoView({behavior: 'smooth', block: 'center'});
            }
          }
          return;
        }
        if (replyBtn && replyPreviewContainer && replyPreviewUser && replyPreviewText) {
          const messageId = replyBtn.getAttribute('data-message-id');
          const user = replyBtn.getAttribute('data-message-user') || '';
          const text = replyBtn.getAttribute('data-message-text') || '';
          currentReplyData = {messageId, user, text};
          replyPreviewUser.textContent = user;
          replyPreviewText.textContent = text.length > 50 ? text.substring(0, 50) + '...' : text;
          replyPreviewContainer.classList.add('active');
          chatInput.focus();
          if (typeof lucide !== 'undefined') lucide.createIcons();
        }
      });
    }
    if (replyPreviewClose) {
      replyPreviewClose.onclick = () => {
        currentReplyData = null;
        if (replyPreviewContainer) replyPreviewContainer.classList.remove('active');
      };
    }
    if (onlineBtn) {
      onlineBtn.addEventListener('click', () => {
        if (!onlineModal) return;
        if (onlineModal.parentElement !== document.body) {
          document.body.appendChild(onlineModal);
        }
        populateOnlineUsersModal();
        onlineModal.classList.add('active');
        document.body.style.overflow = 'hidden';
      });
    }
    if (onlineModalClose) {
      onlineModalClose.addEventListener('click', () => {
        if (onlineModal) onlineModal.classList.remove('active');
        document.body.style.overflow = '';
      });
    }
    if (onlineModal) {
      onlineModal.addEventListener('click', (e) => {
        if (e.target === onlineModal) {
          onlineModal.classList.remove('active');
          document.body.style.overflow = '';
        }
      });
    }
    if (bannedBtn) {
      bannedBtn.addEventListener('click', () => {
        if (!bannedModal) return;
        populateBannedUsersModal();
        bannedModal.classList.add('active');
      });
    }
    if (bannedModalClose) {
      bannedModalClose.addEventListener('click', () => {
        if (bannedModal) bannedModal.classList.remove('active');
      });
    }
    if (bannedList) {
      bannedList.addEventListener('click', (e) => {
        const unbanBtn = e.target.closest('.admin-unban-btn');
        if (!unbanBtn) return;
        const targetEmail = unbanBtn.getAttribute('data-email') || '';
        const targetDevice = unbanBtn.getAttribute('data-device-id') || '';
        if (!targetEmail && !targetDevice) return;
        if (window.confirm('Unban pengguna ini?')) {
          sendChatAction('unban', null, {email: targetEmail, deviceId: targetDevice});
        }
      });
    }
    window.addEventListener('chat:update', (e) => {
      const messages = e && e.detail && e.detail.messages ? e.detail.messages : [];
      renderMessages(messages);
    });
    window.addEventListener('chat-online:update', (e) => {
      const count = e && e.detail ? e.detail.count : 0;
      const users = e && e.detail ? e.detail.users : [];
      updateOnline(count, users);
    });
    window.addEventListener('banned:update', (e) => {
      const users = e && e.detail ? e.detail.users : [];
      updateBanned(users);
    });
    window.addEventListener('chat:user-profile', (e) => {
      const profile = e && e.detail ? e.detail : {};
      applyAutoJoin(profile);
    });
    window.addEventListener('chat:rejected', (e) => {
      const detail = e && e.detail ? e.detail : {};
      const reason = detail.reason || '';
      const message = detail.message || '';
      if (reason === 'banned' && message) {
        appendSystemBubble(message, 'ban');
      } else if (message) {
        appendSystemBubble(message, 'alert-circle');
      }
    });
    if (!joined && isLoggedIn()) {
      const storedProfile = getStoredChatProfile();
      if (storedProfile) {
        applyAutoJoin(storedProfile);
      }
    }
    setTimeout(() => {
      scrollGroupChatToBottom();
    }, 100);
  }

  window.initChatGroup = function () {
    init();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
