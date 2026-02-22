window.originalParse = JSON.parse.bind(window);
window.JSON.parse = function (text, reviver) {
  try {
    return window.originalParse(text, reviver);
  } catch (e) {
    let cleanStr = text.trim().replace(/^\{|\}$/g, '').trim();
    const regex = /([a-zA-Z0-9_]+):\s*([\s\S]*?)(?=\s*[a-zA-Z0-9_]+:\s*|$)/g;
    let match;
    const result = {};
    while ((match = regex.exec(cleanStr)) !== null) {
      let key = match[1].trim();
      let value = match[2].trim();
      if (value.endsWith(',')) {
        value = value.slice(0, -1).trim();
      }
      result[key] = value;
    }
    return result;
  }
}
document.querySelectorAll('button.sidebar-btn').forEach(button => {
  button.addEventListener('click', (e) => {
    localStorage.setItem('sulapfoto_last_menu', e.currentTarget.id);
  });
});
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(function () {
    const button = document.querySelector('button.sidebar-btn#' + (localStorage.getItem('sulapfoto_last_menu') ?? 'tab-beranda'));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, 3000);
});
let API_KEY = window.API_KEY || "";
const MODE_ENDPOINT = (window.MODE_ENDPOINT || "BACKEND").toUpperCase();
const USE_FRONTEND_ENDPOINT = MODE_ENDPOINT === "FRONTEND" || MODE_ENDPOINT === "FRONTED";
let PARAREL_GENERATE = String(window.PARAREL_GENERATE || "FALSE").toUpperCase();
const RAW_BASE_URL = window.BASE_URL;
const BASE_URLS = RAW_BASE_URL.split(',')
.map((item) => item.trim())
.filter(Boolean)
.map((item) => {
  let nextItem = item;
  if (!/^https?:\/\//i.test(nextItem)) {
    nextItem = `https://${nextItem}`;
  }
  return nextItem.replace(/\/$/, "");
});
const pickRandomBase = (list) => {
  if (!Array.isArray(list) || list.length === 0) return "";
  return list[Math.floor(Math.random() * list.length)];
};
const BASE_URL = pickRandomBase(BASE_URLS);
const MULTI_BASE = BASE_URLS.length > 1;
const GENERATE_URL = USE_FRONTEND_ENDPOINT ? `${BASE_URL}/generate` : "/server/proxy.php?generate";
const CHAT_URL = USE_FRONTEND_ENDPOINT ? `${BASE_URL}/chat` : "/server/proxy.php?chat";
const FRONTEND_TOKEN_CACHE = new Map();
let generateQueue = Promise.resolve();
const isGenerateRequest = (url) => {
  if (typeof url !== "string") return false;
  return url.includes("/generate") || url.includes("?generate") || url.includes("generate.php") || url.includes("/nanobananapro");
};
const runGenerateQueued = (task) => {
  const next = generateQueue.then(task, task);
  generateQueue = next.catch(() => {
  });
  return next;
};
const shouldRunParallel = (modeValue) => {
  if (typeof modeValue === "boolean") return modeValue;
  return String(modeValue || "").toUpperCase() === "TRUE";
};
window.showServerToast = function (message) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'server-toast';
  toast.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>
                            <span>${message}</span>
                        `;
  container.appendChild(toast);
  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });
  return toast;
};
window.hideServerToast = function (toast) {
  if (!toast) return;
  toast.classList.remove('show');
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 300);
};
let originalFetch = null;

async function ensureFrontendToken(baseUrl) {
  if (!USE_FRONTEND_ENDPOINT) return "";
  if (!API_KEY) return "";
  const now = Date.now();
  const cached = FRONTEND_TOKEN_CACHE.get(baseUrl);
  if (cached && cached.token && cached.expiresAt > now + 5000) {
    return cached.token;
  }
  const fetchImpl = originalFetch || window.fetch;
  const res = await fetchImpl(`${baseUrl}/token.php`, {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "X-Server": MONITOR_URL,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data && data.success && data.token) {
    const mins = Number(data.expiresInMinutes || 0);
    const expiresAt = Date.now() + mins * 60_000;
    FRONTEND_TOKEN_CACHE.set(baseUrl, {token: data.token, expiresAt});
    return data.token;
  }
  FRONTEND_TOKEN_CACHE.set(baseUrl, {token: "", expiresAt: 0});
  return "";
}

async function fetchWithBase(baseUrl, input, init) {
  const token = await ensureFrontendToken(baseUrl);
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  if (!headers.has("X-API-Key")) headers.set("X-API-Key", API_KEY);
  if (token && !headers.has("Authorization")) headers.set("X-Authorization", `Bearer ${token}`);
  headers.set("X-Server", MONITOR_URL);
  const nextInit = Object.assign({}, init, {headers});
  let nextUrl = input instanceof Request ? input.url : input;
  if (typeof nextUrl === "string") {
    if (nextUrl.startsWith(`${BASE_URL}/`)) {
      nextUrl = baseUrl + nextUrl.slice(BASE_URL.length);
    } else if (nextUrl === BASE_URL) {
      nextUrl = baseUrl;
    }
  }
  let toast = null;
  const isGenerateOrChat = typeof nextUrl === "string" && (nextUrl.includes("/generate") || nextUrl.includes("/chat") || nextUrl.includes("/nanobananapro"));
  if (window.showServerToast && isGenerateOrChat) {
    const sIdx = BASE_URLS.indexOf(baseUrl);
    if (sIdx !== -1) toast = window.showServerToast(`Memproses diserver ${sIdx + 1}...`);
  }
  try {
    if (input instanceof Request) {
      const request = new Request(nextUrl, nextInit);
      return await originalFetch(request);
    }
    return await originalFetch(nextUrl, nextInit);
  } finally {
    if (toast && window.hideServerToast) window.hideServerToast(toast);
  }
}

async function fetchMultiBase(input, init) {
  let lastError = null;
  let targetList = [];
  // Check user preference
  const preferredServer = localStorage.getItem('sulapfoto_boost_server');
  if (preferredServer && preferredServer !== 'random') {
    const idx = parseInt(preferredServer);
    if (!isNaN(idx) && BASE_URLS[idx]) {
      // User selected specific server
      targetList = [BASE_URLS[idx]];
    }
  }
  if (targetList.length === 0) {
    // Default behavior: Random/Shuffle all servers
    targetList = Array.isArray(BASE_URLS) ? [...BASE_URLS] : [];
    for (let i = targetList.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = targetList[i];
      targetList[i] = targetList[j];
      targetList[j] = temp;
    }
  }
  for (const baseUrl of targetList) {
    try {
      const res = await fetchWithBase(baseUrl, input, init);
      if (res.ok) {
        return res;
      }
      if (preferredServer && preferredServer !== 'random') {
        // If user selected a specific server and it failed, throw error immediately
        lastError = new Error(`Gagal Generate di Server ${parseInt(preferredServer) + 1}. Coba ganti server atau pilih Random.`);
      } else {
        lastError = new Error("Gagal Generate karena melanggar kebijakan. coba foto lain atau ganti intruksi..");
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Gagal Generate. Semua server sibuk atau bermasalah.");
}

if (USE_FRONTEND_ENDPOINT && typeof FormData !== "undefined" && !FormData.prototype.__sulapfotoPatched) {
  const originalAppend = FormData.prototype.append;
  FormData.prototype.append = function (name, value, filename) {
    const nextName = name === "images[]" ? "images" : name;
    let nextValue = value;
    let nextFilename = filename;
    if (filename !== undefined && !(value instanceof Blob)) {
      if (typeof value === "string" && value.startsWith("data:")) {
        const match = value.match(/^data:(.*?);base64,(.*)$/);
        if (match) {
          const mimeType = match[1];
          const base64 = match[2];
          const byteCharacters = atob(base64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          nextValue = new Blob([byteArray], {type: mimeType});
        }
      }
      if (!(nextValue instanceof Blob)) {
        return originalAppend.call(this, nextName, nextValue);
      }
    }
    if (nextFilename === undefined) {
      return originalAppend.call(this, nextName, nextValue);
    }
    return originalAppend.call(this, nextName, nextValue, nextFilename);
  };
  FormData.prototype.__sulapfotoPatched = true;
}
if (window.location.href.includes('blob:https') && typeof window.fetch === 'function') {
  originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = input instanceof Request ? input.url : input;
    console.log('fetch', input, init)
    if (init.body) {
      const body = {};
      for (const [key, value] of init.body.entries()) {
        const cleanKey = key.endsWith('[]') ? key.slice(0, -2) : key;
        if (body[cleanKey]) {
          if (Array.isArray(body[cleanKey])) {
            body[cleanKey].push(value);
          } else {
            body[cleanKey] = [body[cleanKey], value];
          }
        } else {
          body[cleanKey] = key.endsWith('[]') ? [value] : value;
        }
      }
      const fileToBase64 = (file) => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = (error) => reject(error);
        });
      };
      console.log(init, body)
      if (url.includes('/generate')) {
        const parts = [{text: body.instruction ?? body.prompt}];
        for (const image of Array.isArray(body.images ?? []) ? body.images ?? [] : [body.images,]) {
          parts.push({inlineData: {mimeType: image.type, data: await fileToBase64(image)}});
        }
        function nearestStandardRatio(ratioStr) {
          const standards = [
            '1:1',
            '4:3',
            '3:4',
            '16:9',
            '9:16',
            '3:2',
            '2:3',
          ];
          const [w, h] = ratioStr.split(":").map(Number);
          const target = w / h;
          let closest = standards[0];
          let minDiff = Infinity;
          for (const r of standards) {
            const [sw, sh] = r.split(":").map(Number);
            const sr = sw / sh;
            const diff = Math.abs(sr - target);
            if (diff < minDiff) {
              minDiff = diff;
              closest = r;
            }
          }
          return closest;
        }

        const payload = {
          contents: [{parts: parts,},],
          generationConfig: {
            responseModalities: ['IMAGE',],
            imageConfig: {aspectRatio: body.aspectRatio ? nearestStandardRatio(body.aspectRatio) : undefined,},
          },
        };
        const response = await originalFetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
        if (!response.ok) console.log(response);
        const originalJson = response.json.bind(response);
        response.json = async () => {
          const result = await originalJson();
          console.log(result);
          const data = result?.candidates?.[0]?.content?.parts?.find(part => part.inlineData)?.inlineData?.data;
          if (data) {
            return {
              ...result,
              success: response.ok,
              imageUrl: `data:image/png;base64,${data}`,
            };
          }
          return result;
        };
        return response;
      } else if (url.includes('/chat')) {
        const payload = {
          contents: [{parts: [{text: body.prompt}]}],
          systemInstruction: {parts: [/*{text: body.systemPrompt, }*/]}
        };
        if (body.responseMimeType) {
          payload['generationConfig'] = {
            ...payload['generationConfig'],
            responseMimeType: body.responseMimeType,
          };
        }
        const response = await originalFetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
        if (!response.ok) console.log(response);
        const originalJson = response.json.bind(response);
        response.json = async () => {
          const result = await originalJson();
          console.log(result);
          const data = result.candidates[0].content.parts[0].text.trim().replace(/["*]/g, '');
          if (data) {
            return {
              ...result,
              response: data,
              success: response.ok,
            };
          }
          return result;
        };
        return response;
      }
    } else {
      return originalFetch(url, init);
    }
  };
} else if (USE_FRONTEND_ENDPOINT && API_KEY && typeof window.fetch === "function") {
  originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = input instanceof Request ? input.url : input;
    if (typeof url === "string") {
      const isToken = url.includes(`/token`);
      const isGenerate = url.includes(`/generate`);
      const isChat = url.includes(`/chat`);
      const isNano = url.includes('/nanobananapro');
      if (isToken) {
        input = input.replace('token', 'token.php');
      }
      if (isGenerate) {
        input = input.replace('generate', 'generate.php');
      }
      if (isChat) {
        input = input.replace('chat', 'instruksi.php');
      }
      if (isNano) {
        input = input.replace('nanobananapro', 'nanobananapro.php');
      }
      const runRequest = async () => {
        if (MULTI_BASE && (isGenerate || isChat || isNano)) {
          return fetchMultiBase(input, init);
        }
        if (url.startsWith(`${BASE_URL}/`) || url === BASE_URL) {
          const token = await ensureFrontendToken(BASE_URL);
          const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
          if (!headers.has("X-API-Key")) headers.set("X-API-Key", API_KEY);
          if (token && !headers.has("Authorization")) headers.set("X-Authorization", `Bearer ${token}`);
          headers.set("X-Server", MONITOR_URL);
          const nextInit = Object.assign({}, init, {headers});
          if (input instanceof Request) {
            const request = new Request(input, nextInit);
            return originalFetch(request);
          }
          return originalFetch(input, nextInit);
        }
        return originalFetch(input, init);
      };
      if ((isGenerate || isNano) && !shouldRunParallel(PARAREL_GENERATE)) {
        return runGenerateQueued(runRequest);
      }
      return runRequest();
    }
    return originalFetch(input, init);
  };
} else if (!USE_FRONTEND_ENDPOINT && typeof window.fetch === "function") {
  // BACKEND mode: intercept fetch to show server toast for generate/chat
  originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = input instanceof Request ? input.url : input;
    const isGenerateOrChat = typeof url === "string" && (url.includes("/generate") || url.includes("?generate") || url.includes("/chat") || url.includes("?chat") || url.includes("/nanobananapro"));
    const runRequest = async () => {
      let toast = null;
      if (isGenerateOrChat && window.showServerToast) {
        const sIdx = Math.floor(Math.random() * Math.max(1, BASE_URLS.length));
        toast = window.showServerToast(`Memproses diserver ${sIdx + 1}...`);
      }
      try {
        return await originalFetch(input, init);
      } finally {
        if (toast && window.hideServerToast) window.hideServerToast(toast);
      }
    };
    if (isGenerateRequest(url) && !shouldRunParallel(PARAREL_GENERATE)) {
      return runGenerateQueued(runRequest);
    }
    return runRequest();
  };
}
let currentSession = {
  email: null
};
const DEVICE_ID_KEY = 'sulapfoto_device_id';

function getOrCreateDeviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
  } catch (e) {
  }
  let id = '';
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    id = window.crypto.randomUUID();
  } else if (window.crypto && window.crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    id = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  id = `${Math.random().toString(36).slice(2)}${id}${Math.random().toString(36).slice(2)}`
  try {
    localStorage.setItem(DEVICE_ID_KEY, id);
  } catch (e) {
  }
  return id;
}

const deviceId = getOrCreateDeviceId();
// Session management removed as per request
window.addEventListener('load', async () => {
  let shouldSkipVerification = false;
  let foundEmail = null;
  let fotoMiniatur = null; // Module instance
  let editFoto = null;
  let perbaikiFoto = null;
  let buatBannerModule = null;
  const savedEmail = localStorage.getItem('sulapfoto_verified_email') ?? 'رَحْمَةشِفَاء ~ syifarahmat.id@gmail.com';
  if (savedEmail) {
    foundEmail = savedEmail;
    console.log('Email ditemukan di localStorage:', foundEmail);
  }
  let QUOTA_LIMIT = 0;
  const systemInfoCard = document.getElementById('systeminfo-card');
  if (systemInfoCard) {
    const statusEl = document.getElementById('systeminfo-status');
    const gridEl = document.getElementById('systeminfo-grid');
    const totalLabelEl = document.getElementById('systeminfo-total-label');
    if (!gridEl) {
      if (statusEl) {
        statusEl.className = 'inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold border border-red-200 bg-red-50 text-red-600';
        statusEl.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-500"></span>Offline';
      }
      return;
    }
    const baseCandidates = /*Array.isArray(BASE_URLS) ? BASE_URLS : []*/ MONITOR_URL.split(',');
    const normalizedBases = baseCandidates.map((base) => {
      if (!base || typeof base !== 'string') return '';
      let nextBase = base.trim();
      if (!nextBase) return '';
      if (!/^https?:\/\//i.test(nextBase)) {
        nextBase = `https://${nextBase}`;
      }
      return nextBase.replace(/\/$/, '');
    }).filter(Boolean);
    const fallbackBase = typeof BASE_URL === 'string' && BASE_URL ? [BASE_URL.replace(/\/$/, '')] : [];
    const baseUrls = Array.from(new Set((normalizedBases.length ? normalizedBases : fallbackBase)));
    const totalBases = baseUrls.length || 1;
    gridEl.style.gridTemplateColumns = `repeat(${totalBases}, minmax(160px, 1fr))`;
    gridEl.innerHTML = '';
    const cardRefs = baseUrls.map((baseUrl, index) => {
      const label = `Server ${index + 1}`;
      const card = document.createElement('div');
      card.className = 'rounded-2xl border border-slate-100 bg-gradient-to-br from-white via-teal-50/40 to-white p-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.08)] min-w-[160px] flex flex-col gap-2 relative overflow-hidden';
      card.innerHTML = `
                        <div class="absolute -top-6 -right-6 w-20 h-20 bg-emerald-400/15 blur-2xl rounded-full"></div>
                        <div class="flex items-center justify-between gap-2">
                            <div class="text-[10px] font-semibold text-slate-600">${label}</div>
                            <span class="systeminfo-status inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold border border-slate-200 bg-slate-50 text-slate-600">
                                <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                                Memuat
                            </span>
                        </div>
                        <div class="grid grid-cols-2 gap-1.5">
                            <div>
                                <p class="text-[9px] font-bold uppercase tracking-wider text-slate-500">CPU</p>
                                <div class="systeminfo-cpu text-xs font-bold text-sky-600 mt-0.5">—</div>
                            </div>
                            <div>
                                <p class="text-[9px] font-bold uppercase tracking-wider text-slate-500">RAM</p>
                                <div class="systeminfo-ram text-xs font-bold text-violet-600 mt-0.5">—</div>
                            </div>
                            <div>
                                <p class="text-[9px] font-bold uppercase tracking-wider text-slate-500">Storage</p>
                                <div class="systeminfo-storage text-xs font-bold text-amber-600 mt-0.5">—</div>
                            </div>
                            <div>
                                <p class="text-[9px] font-bold uppercase tracking-wider text-slate-500">Uptime</p>
                                <div class="systeminfo-uptime text-xs font-bold text-emerald-600 mt-0.5">—</div>
                            </div>
                        </div>
                        <div class="systeminfo-total text-[10px] text-slate-500 font-semibold pt-1.5 border-t border-slate-100">—</div>
                    `;
      gridEl.appendChild(card);
      return {
        baseUrl,
        statusEl: card.querySelector('.systeminfo-status'),
        cpuEl: card.querySelector('.systeminfo-cpu'),
        ramEl: card.querySelector('.systeminfo-ram'),
        storageEl: card.querySelector('.systeminfo-storage'),
        uptimeEl: card.querySelector('.systeminfo-uptime'),
        totalEl: card.querySelector('.systeminfo-total')
      };
    });
    const setCardStatus = (card, isOnline) => {
      if (!card.statusEl) return;
      if (isOnline) {
        card.statusEl.className = 'systeminfo-status inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold border border-emerald-200 bg-emerald-50 text-emerald-600';
        card.statusEl.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Online';
        return;
      }
      card.statusEl.className = 'systeminfo-status inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold border border-red-200 bg-red-50 text-red-600';
      card.statusEl.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-red-500"></span>Offline';
    };
    const setOverallStatus = (onlineCount, totalCount) => {
      if (!statusEl) return;
      if (onlineCount === 0) {
        statusEl.className = 'inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold border border-red-200 bg-red-50 text-red-600';
        statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500"></span>Offline 0/${totalCount}`;
        return;
      }
      if (onlineCount < totalCount) {
        statusEl.className = 'inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold border border-amber-200 bg-amber-50 text-amber-700';
        statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500"></span>Online ${onlineCount}/${totalCount}`;
        return;
      }
      statusEl.className = 'inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold border border-emerald-200 bg-emerald-50 text-emerald-600';
      statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span>Online ${onlineCount}/${totalCount}`;
    };
    const parseTotalValue = (rawValue) => {
      if (rawValue === undefined || rawValue === null || rawValue === '') return null;
      const numeric = Number(String(rawValue).replace(/[^\d]/g, ''));
      return Number.isFinite(numeric) ? numeric : null;
    };
    const formatNumber = (value) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
      return new Intl.NumberFormat('en-US').format(value);
    };
    const updateTotalLabel = () => {
      if (!totalLabelEl) return;
      const totalSum = cardRefs.reduce((sum, card) => {
        return sum + (typeof card.totalValue === 'number' ? card.totalValue : 0);
      }, 0);
      totalLabelEl.textContent = `Total: ${formatNumber(totalSum)} Gambar Dihasilkan.`;
    };
    const fetchSystemInfo = async (card) => {
      try {
        const headers = API_KEY ? {'X-API-Key': API_KEY} : undefined;
        const response = await fetch(`${card.baseUrl}/systeminfo`, {cache: 'no-store', headers});
        if (!response.ok) throw new Error('systeminfo');
        const data = await response.json();
        if (card.cpuEl) card.cpuEl.textContent = data.cpu !== undefined && data.cpu !== null ? `${data.cpu}%` : '—';
        if (card.ramEl) card.ramEl.textContent = data.ram !== undefined && data.ram !== null ? `${data.ram}%` : '—';
        const storageValue = data.storage ?? data.disk ?? data.diskUsage ?? data.storageUsed;
        if (card.storageEl) card.storageEl.textContent = storageValue !== undefined && storageValue !== null && storageValue !== '' ? `${storageValue}` : '—';
        if (card.uptimeEl) {
          if (data.uptime === undefined || data.uptime === null || data.uptime === '') {
            card.uptimeEl.textContent = '—';
          } else if (typeof data.uptime === 'string') {
            card.uptimeEl.textContent = data.uptime;
          } else {
            card.uptimeEl.textContent = `${data.uptime} Jam`;
          }
        }
        if (card.totalEl) {
          const totalImages = data.totalGeneratedImages ?? data.total_generated_images ?? data.totalGenerated ?? data.total;
          const totalValue = parseTotalValue(totalImages);
          card.totalValue = totalValue;
          const formattedTotal = totalValue !== null ? formatNumber(totalValue) : null;
          card.totalEl.innerHTML = totalValue !== null
            ? `Total: <span class="text-black font-bold">${formattedTotal}</span> gambar telah dihasilkan dari server ini.`
            : '—';
        }
        setCardStatus(card, true);
        updateTotalLabel();
        return true;
      } catch (error) {
        setCardStatus(card, false);
        if (card.totalEl) card.totalEl.textContent = '—';
        card.totalValue = null;
        updateTotalLabel();
        return false;
      }
    };
    let isRefreshing = false;
    const refreshSystemInfo = () => {
      if (isRefreshing) return;
      let completedCount = 0;
      let onlineCount = 0;
      const totalCount = cardRefs.length || 1;
      if (cardRefs.length === 0) {
        setOverallStatus(0, totalCount);
        return;
      }
      isRefreshing = true;
      cardRefs.forEach((card) => {
        fetchSystemInfo(card).then((isOnline) => {
          completedCount += 1;
          if (isOnline) onlineCount += 1;
          if (completedCount === cardRefs.length) {
            isRefreshing = false;
          }
          setOverallStatus(onlineCount, totalCount);
        });
      });
    };
    window.refreshSystemInfo = refreshSystemInfo;
    refreshSystemInfo();
    setInterval(refreshSystemInfo, 5000 * 10);
  }

  function loadScriptAsync(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function loadFaceApiScript() {
    loadScriptAsync('https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js')
    .then(() => console.log('face-api.js loaded successfully'))
    .catch(err => console.warn('face-api.js failed to load:', err));
  }

  const sessionDb = null; // Stub to prevent immediate crash
  // Auto-login logic simplified (removed Firebase session check)
  if (foundEmail) {
    shouldSkipVerification = true;
  }
  // Online sessions list logic removed
  let onlineSessionsList = [];

  function maskEmail(email) {
    if (!email || typeof email !== 'string') return '***@***.***';
    const parts = email.split('@');
    if (parts.length !== 2) return '***@***.***';
    const [localPart, domain] = parts;
    let maskedLocal;
    if (localPart.length <= 4) {
      maskedLocal = localPart.charAt(0) + '*'.repeat(Math.max(1, localPart.length - 1));
    } else {
      maskedLocal = localPart.slice(0, 2) + '*'.repeat(localPart.length - 4) + localPart.slice(-2);
    }
    return maskedLocal + '@' + domain;
  }

  function updateSidebarOnlineCount() {
    const countEl = document.getElementById('sidebar-online-count');
    if (countEl) {
      countEl.textContent = '0';
    }
  }

  const CURRENT_APP_VERSION = "5.0";
  window.assistantMessages = [];
  let configPollInterval = null;
  let currentOnlineUsers = []; // Store online users list
  let currentChatOnlineUsers = [];
  let pendingChatQueue = [];
  let latestChatMessages = [];
  let latestBannedUsers = [];
  let latestChatUserProfile = null;
  window.queueChatMessage = function (message) {
    if (!message) return;
    if (typeof message === 'string') {
      const trimmed = message.trim();
      if (!trimmed) return;
      pendingChatQueue.push(trimmed);
    } else if (typeof message === 'object') {
      const text = typeof message.text === 'string' ? message.text.trim() : '';
      if (!text) return;
      const payload = {
        text,
        user: typeof message.user === 'string' ? message.user.trim() : '',
        province: typeof message.province === 'string' ? message.province.trim() : '',
        isVip: !!message.isVip,
        isAdmin: !!message.isAdmin,
        replyTo: message.replyTo && typeof message.replyTo === 'object' ? {
          messageId: message.replyTo.messageId || null,
          user: typeof message.replyTo.user === 'string' ? message.replyTo.user : '',
          text: typeof message.replyTo.text === 'string' ? message.replyTo.text : ''
        } : null
      };
      pendingChatQueue.push(payload);
    } else {
      return;
    }
    if (typeof checkAppConfig === 'function') {
      checkAppConfig(false);
    }
  };
  window.getChatMessages = function () {
    return latestChatMessages.slice();
  };

  function performLogout() {
    try {
      localStorage.removeItem('sulapfoto_verified_email');
    } catch (err) {
    }
    if (window.autoLogoutGroupChat) window.autoLogoutGroupChat();
    currentSession.email = null;
    const profileSection = document.getElementById('user-profile-section');
    if (profileSection) {
      profileSection.classList.add('hidden');
    }
    const verifyOverlay = document.getElementById('verification-overlay');
    if (verifyOverlay) {
      verifyOverlay.style.display = 'flex';
      verifyOverlay.classList.remove('opacity-0', 'scale-110');
    }
    if (document.body) document.body.classList.add('overflow-hidden');
    const verifyEmailInput = document.getElementById('verification-email');
    const verifyMsg = document.getElementById('verification-message');
    const verifyBtn = document.getElementById('verification-btn');
    if (verifyEmailInput) verifyEmailInput.value = '';
    if (verifyMsg) verifyMsg.classList.add('hidden');
    if (verifyBtn) {
      verifyBtn.disabled = false;
      verifyBtn.innerHTML = `
                                <span>Masuk Aplikasi</span>
                                <i data-lucide="arrow-right" class="w-4 h-4"></i>
                            `;
    }
  }

  function handleForcedLogout(reason) {
    performLogout();
    try {
      const verifyMsg = document.getElementById('verification-message');
      if (verifyMsg) {
        const reasonText = typeof reason === 'string' ? reason.toLowerCase() : '';
        const isDeviceLogin = reasonText.includes('perangkat lain') || reasonText.includes('device') || reasonText.includes('login');
        if (isDeviceLogin) {
          verifyMsg.textContent = "Email anda baru saja login di device lain";
          verifyMsg.className = "p-3 rounded-lg text-xs font-medium text-center bg-red-100 text-red-600 block mb-4";
          verifyMsg.classList.remove('hidden');
        }
      }
    } catch (e) {
    }
  }

  let isCheckingAppConfig = false;

  function checkAppConfig(isLoginEvent = false) {
    if (window.location.href.includes('blob:https')) return;
    if (isCheckingAppConfig) return;
    isCheckingAppConfig = true;
    const payload = {};
    if (currentSession && currentSession.email) {
      payload.email = currentSession.email;
    }
    if (deviceId) {
      payload.device_id = deviceId;
    }
    if (isLoginEvent) {
      payload.login = true;
    }
    if (typeof window !== 'undefined' && typeof window.IS_VIP_APP !== 'undefined') {
      payload.is_vip_app = !!window.IS_VIP_APP;
    }
    if (latestChatUserProfile && latestChatUserProfile.username) {
      payload.chat_username = latestChatUserProfile.username;
      if (latestChatUserProfile.province) {
        payload.chat_province = latestChatUserProfile.province;
      }
    }
    // Check if user is currently in chat group
    const contentBeranda = document.getElementById('content-beranda');
    const berandaContentGroup = document.getElementById('beranda-content-group');
    if (contentBeranda && !contentBeranda.classList.contains('hidden') &&
      berandaContentGroup && !berandaContentGroup.classList.contains('hidden')) {
      payload.is_in_chat_group = true;
    } else {
      payload.is_in_chat_group = false;
    }
    const nextChatMessage = pendingChatQueue.length > 0 ? pendingChatQueue[0] : '';
    if (nextChatMessage) {
      payload.chat_message = nextChatMessage;
    }
    if (window.currentPaymentReference) {
      payload.payment_reference = window.currentPaymentReference;
    }
    // Realtime Boost Quota Update
    if (typeof window.fetchBoostQuota === 'function') {
      window.fetchBoostQuota();
    }
    fetch('server/proxy.php?config=true', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(config => {
      if (config.error) {
        console.error("Config Error:", config.error);
        return;
      }
      if (nextChatMessage) {
        pendingChatQueue.shift();
      }
      if (config.force_logout) {
        handleForcedLogout(config.force_logout_reason);
        return;
      }
      // Update Online Count & List
      if (config.online_count !== undefined) {
        const countEl = document.getElementById('sidebar-online-count');
        if (countEl) {
          countEl.textContent = config.online_count;
        }
      }
      if (config.online_users) {
        currentOnlineUsers = config.online_users;
      }
      if (config.chat_online_users) {
        currentChatOnlineUsers = config.chat_online_users;
      }
      if (Array.isArray(config.chat_messages)) {
        latestChatMessages = config.chat_messages;
      }
      if (Array.isArray(config.banned_users)) {
        latestBannedUsers = config.banned_users;
      }
      if (config.chat_user_profile && config.chat_user_profile.username) {
        latestChatUserProfile = {
          username: config.chat_user_profile.username,
          province: config.chat_user_profile.province || ''
        };
        try {
          window.dispatchEvent(new CustomEvent('chat:user-profile', {detail: config.chat_user_profile}));
        } catch (e) {
        }
      }
      try {
        window.dispatchEvent(new CustomEvent('online:update', {
          detail: {
            count: config.online_count || 0,
            users: currentOnlineUsers
          }
        }));
        window.dispatchEvent(new CustomEvent('chat-online:update', {
          detail: {
            count: config.chat_online_count || 0,
            users: currentChatOnlineUsers
          }
        }));
        window.dispatchEvent(new CustomEvent('chat:update', {
          detail: {
            messages: latestChatMessages
          }
        }));
        window.dispatchEvent(new CustomEvent('banned:update', {
          detail: {
            users: latestBannedUsers
          }
        }));
      } catch (e) {
      }
      if (nextChatMessage && config.chat_rejected) {
        try {
          window.dispatchEvent(new CustomEvent('chat:rejected', {
            detail: config.chat_rejected
          }));
        } catch (e) {
        }
      }
      // Maintenance Mode Logic
      if (config.refresh_app === true) {
        let maintenanceModal = document.getElementById('maintenance-mode-modal');
        if (!maintenanceModal) {
          maintenanceModal = document.createElement('div');
          maintenanceModal.id = 'maintenance-mode-modal';
          maintenanceModal.className = 'fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/95 backdrop-blur-md animate-in fade-in duration-300';
          maintenanceModal.innerHTML = `
                                    <div class="text-center">
                                         <div class="w-14 h-14 rounded-full mx-auto mb-4 border-4 border-teal-500 border-t-transparent animate-spin flex-shrink-0"></div>
                                         <h3 class="text-xl font-bold text-white mb-2">Pembaruan Sistem</h3>
                                        <p class="text-slate-400 text-sm">Sedang memproses pembaruan sistem...<br>Halaman akan dimuat ulang otomatis setelah selesai.</p>
                                    </div>
                                `;
          document.body.appendChild(maintenanceModal);
          document.body.style.overflow = 'hidden';
        }
        // Speed up polling to 5 seconds if not already fast
        if (configPollInterval) clearInterval(configPollInterval);
        /*configPollInterval = setInterval(checkAppConfig, 5000);*/
        if (typeof window.refreshSystemInfo === 'function') {
          window.refreshSystemInfo();
        }
        return; // Stop further processing and DO NOT reload yet
      } else {
        // If maintenance modal exists, it means we just finished maintenance -> Reload
        const maintenanceModal = document.getElementById('maintenance-mode-modal');
        if (maintenanceModal) {
          maintenanceModal.remove();
          document.body.style.overflow = '';
          window.location.reload();
          return;
        }
      }
      if (configPollInterval && config.refresh_app !== true) {
      }
      if (typeof window.updateSystemInfoUI === 'function' && config.system_info) {
        window.updateSystemInfoUI(config.system_info);
      }
      if (config.payment_status && typeof window.handlePaymentStatusUpdate === 'function') {
        window.handlePaymentStatusUpdate(config.payment_status);
      }
      if (config.assistant) {
        window.assistantMessages = [config.assistant];
        // Dispatch event for assistant.js to pick up
        window.dispatchEvent(new CustomEvent('assistant:messages-updated'));
      }
      // Map DB columns to logic
      const remoteVersion = config.version_sulapfoto;
      let updateUrl = config.url_sulapfotopro || '#';
      if (updateUrl !== '#' && !updateUrl.startsWith('http')) {
        updateUrl = 'https://' + updateUrl;
      }
      if (remoteVersion && String(remoteVersion) !== String(CURRENT_APP_VERSION)) {
        let modal = document.getElementById('blocking-update-modal');
        if (!modal) {
          modal = document.createElement('div');
          modal.id = 'blocking-update-modal';
          modal.className = 'fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-300';
          document.body.appendChild(modal);
          document.body.style.overflow = 'hidden';
          if (typeof autoLogoutGroupChat === 'function') {
            autoLogoutGroupChat();
          }
        }
        var link = `*Update Tersedia !*
Hai Brow....
Versi Aplikasi Anda Sulap Foto ${CURRENT_APP_VERSION} Sudah Usang.
Mohon Update Ke Versi Terbaru ${remoteVersion}.
👉 ${window.location.origin}/?ref=6282266331136
Trimakasih`
        modal.innerHTML = `
                                 <div class="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-8 shadow-2xl text-center">
                                    <div class="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-teal-500/20 mb-6 animate-bounce">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-rocket h-10 w-10 text-teal-400"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>
                                    </div>
                                    <h3 class="text-2xl font-bold text-white mb-2">Update Tersedia !</h3>
                                    <p class="text-slate-400 mb-8 leading-relaxed text-sm">
                                        Versi Aplikasi Anda (${CURRENT_APP_VERSION}) Audah Usang. <br/>
                                        Mohon Update Ke Versi Terbaru (${remoteVersion}) Atau Tunggu 3 Detik.
                                    </p>
                                    <a href="https://api.whatsapp.com/send?phone=6282266331136&text=${encodeURI(link)}" target="_blank" class="block w-full text-center bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-white font-bold py-3.5 px-6 rounded-xl shadow-lg shadow-teal-500/20 transition-all transform hover:scale-[1.02] active:scale-95">
                                        WhatsApp Sekarang
                                    </a>
                                </div>
                            `;
        // Re-init lucide icons if available
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    })
    .catch(e => console.error("Config check error:", e));
    setTimeout(function () {
      const modal = document.getElementById('blocking-update-modal');
      if (modal) {
        modal.remove();
        document.body.style.overflow = '';
      }
    }, 30000);
  }

  // Call it
  checkAppConfig();
  if (configPollInterval) clearInterval(configPollInterval);
  /*configPollInterval = setInterval(checkAppConfig, 5000);*/
  window.addEventListener('chat:profile-selected', (e) => {
    const detail = e && e.detail ? e.detail : {};
    const username = typeof detail.username === 'string' ? detail.username.trim() : '';
    const province = typeof detail.province === 'string' ? detail.province.trim() : '';
    if (!username) return;
    latestChatUserProfile = {
      username,
      province
    };
    checkAppConfig(false);
  });
  // Add listener for Online Users Sidebar Button
  const onlineUsersBtn = document.getElementById('sidebar-online-users-btn');
  if (onlineUsersBtn) {
    onlineUsersBtn.addEventListener('click', () => {
      const modal = document.getElementById('sidebar-online-modal');
      const closeBtn = document.getElementById('sidebar-online-modal-close');
      const listEl = document.getElementById('sidebar-online-list');
      if (!modal || !listEl) return;
      if (modal.dataset.bound !== '1') {
        modal.dataset.bound = '1';
        if (closeBtn) {
          closeBtn.addEventListener('click', () => {
            modal.classList.remove('active');
          });
        }
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            modal.classList.remove('active');
          }
        });
      }
      listEl.innerHTML = '';
      if (currentOnlineUsers.length === 0) {
        listEl.innerHTML = '<p class="text-center text-sm text-gray-500 py-4">Tidak ada pengguna online.</p>';
      } else {
        currentOnlineUsers.forEach(user => {
          const item = document.createElement('div');
          item.className = 'sidebar-online-item';
          const avatar = document.createElement('div');
          avatar.className = 'sidebar-online-avatar';
          const initial = (user.email || 'U').charAt(0).toUpperCase();
          avatar.textContent = initial;
          const info = document.createElement('div');
          info.className = 'sidebar-online-info';
          const emailEl = document.createElement('div');
          emailEl.className = 'sidebar-online-email';
          emailEl.textContent = user.email;
          info.appendChild(emailEl);
          const username = typeof user.username === 'string' ? user.username.trim() : '';
          const province = typeof user.province === 'string' ? user.province.trim() : '';
          if (username || province) {
            const tags = document.createElement('div');
            tags.className = 'sidebar-online-tags';
            if (username) {
              const tag = document.createElement('span');
              tag.className = 'sidebar-online-tag';
              tag.textContent = username;
              tags.appendChild(tag);
            }
            if (province) {
              const tag = document.createElement('span');
              tag.className = 'sidebar-online-tag secondary';
              tag.textContent = province;
              tags.appendChild(tag);
            }
            info.appendChild(tags);
          }
          const meta = document.createElement('div');
          meta.className = 'sidebar-online-meta';
          if (user.is_vip) {
            const badge = document.createElement('span');
            badge.className = 'sidebar-online-badge vip';
            badge.textContent = 'VIP';
            meta.appendChild(badge);
          }
          item.appendChild(avatar);
          item.appendChild(info);
          if (meta.childNodes.length > 0) {
            item.appendChild(meta);
          }
          listEl.appendChild(item);
        });
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
      modal.classList.add('active');
    });
  }
  const database = null;
  const verifyOverlay = document.getElementById('verification-overlay');
  const verifyForm = document.getElementById('verification-form');
  const verifyEmailInput = document.getElementById('verification-email');
  const verifyBtn = document.getElementById('verification-btn');
  const verifyMsg = document.getElementById('verification-message');
  const bodyEl = document.body;
  const bannedEmailRaw = typeof window !== 'undefined' && typeof window.BANNED_EMAIL === 'string' ? window.BANNED_EMAIL : '';
  const bannedEmailList = bannedEmailRaw.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  const isBannedEmail = (email) => {
    if (!email) return false;
    const normalized = String(email).trim().toLowerCase();
    if (!normalized) return false;
    return bannedEmailList.some((item) => {
      if (!item) return false;
      if (item.includes('@')) return normalized === item;
      return normalized.endsWith(`@${item}`) || normalized === item;
    });
  };

  function collectStrings(obj, acc = []) {
    if (obj == null) return acc;
    const t = typeof obj;
    if (t === 'string') {
      acc.push(obj);
      return acc;
    }
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) collectStrings(obj[i], acc);
      return acc;
    }
    if (t === 'object') {
      const keys = Object.keys(obj);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        collectStrings(obj[k], acc);
      }
    }
    return acc;
  }

  function isVipProduct(data) {
    const all = collectStrings(data).join(' ').toLowerCase();
    if (!all) return false;
    if (all.includes('sulap foto vip')) return true;
    if (/\bvip\b/.test(all)) return true;
    return false;
  }

  function isVipRoute() {
    if (typeof window === 'undefined') return false;
    const path = String(window.location && window.location.pathname ? window.location.pathname : '');
    if (path === '/vipacc' || path === '/vipacc/') return true;
    if (path.endsWith('/vipacc') || path.includes('/vipacc/')) return true;
    const search = String(window.location && window.location.search ? window.location.search : '');
    if (search.includes('app=vipacc')) return true;
    return false;
  }

  function shouldRedirectVip(data) {
    if (!isVipProduct(data)) return false;
    if (isVipRoute()) return false;
    return true;
  }

  const verifyOrderAccess = (data) => {
    console.log('Verifying access for data:', data);
    // New API logic
    if (data && data.canAccess === true) {
      return true;
    }
    return false;
  };
  const monitorSession = (email) => {
    currentSession.email = email;
    const profileSection = document.getElementById('user-profile-section');
    const emailDisplay = document.getElementById('user-display-email');
    if (profileSection && emailDisplay) {
      emailDisplay.textContent = email;
      emailDisplay.title = email;
      profileSection.classList.remove('hidden');
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  };
  if (shouldSkipVerification && foundEmail) {
    if (isBannedEmail(foundEmail)) {
      try {
        localStorage.removeItem('sulapfoto_verified_email');
      } catch (e) {
      }
      shouldSkipVerification = false;
    }
  }
  if (shouldSkipVerification && foundEmail && !window.top.location.href.includes('gemini')) {
    console.log('Memulai proses auto-login dengan email:', foundEmail);
    try {
      // Direct API call to bypass proxy issues
      const response = await fetch(`server/proxy.php?email`, {
        method: 'POST',
        cache: "no-store",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({email: foundEmail})
      });
      const data = await response.json();
      console.log('Response dari API check:', data);
      if (verifyOrderAccess(data)) {
        try {
          if (shouldRedirectVip(data)) {
            window.location.href = 'vipacc';
            return;
          }
        } catch (e) {
        }
        // Session logic removed
        loadFaceApiScript();
        try {
          if (typeof window.backgroundMusic !== 'undefined' && window.backgroundMusic && typeof window.backgroundMusic.playing === 'function' && window.backgroundMusic.playing()) {
            window.backgroundMusic.pause();
          }
        } catch (e) {
        }
        monitorSession(foundEmail);
        if (typeof checkAppConfig === 'function') {
          checkAppConfig(true);
        }
        if (verifyOverlay) {
          verifyOverlay.style.display = 'none';
        }
        if (bodyEl) bodyEl.classList.remove('overflow-hidden');
        // Sync boost quota after auto-login
        if (window.fetchBoostQuota) {
          window.fetchBoostQuota();
        }
        console.log('Auto-login berhasil dengan email:', foundEmail);
        shouldSkipVerification = true;
      } else {
        console.log('Auto-login gagal: API tidak memberikan akses');
        console.log('Response data:', data);
        shouldSkipVerification = false;
      }
    } catch (error) {
      console.error('Auto-login error:', error);
      shouldSkipVerification = false;
    }
  } else {
    console.log('Auto-login tidak dilakukan - shouldSkipVerification:', shouldSkipVerification, 'foundEmail:', foundEmail);
  }
  if (!shouldSkipVerification && verifyOverlay) {
    verifyOverlay.style.display = 'flex';
    bodyEl.classList.add('overflow-hidden');
    if (foundEmail && verifyEmailInput) {
      verifyEmailInput.value = foundEmail;
      console.log('Email di-auto-fill ke form verifikasi dari localStorage:', foundEmail);
      if (isBannedEmail(foundEmail)) {
        if (verifyMsg) {
          verifyMsg.textContent = "Email ini diblokir dari akses aplikasi.";
          verifyMsg.className = "p-3 rounded-lg text-xs font-medium text-center bg-red-100 text-red-600 block mb-4";
          verifyMsg.classList.remove('hidden');
        }
        verifyEmailInput.classList.add('border-red-500', 'focus:ring-red-500');
      } else {
        // Auto-click verification logic simplified
        setTimeout(() => {
          if (verifyBtn && !verifyBtn.disabled) {
            verifyBtn.click();
          }
        }, 500);
      }
    }
    try {
      if (typeof window.backgroundMusic !== 'undefined' && window.backgroundMusic && typeof window.backgroundMusic.playing === 'function' && !window.backgroundMusic.playing()) {
        window.backgroundMusic.play();
      }
    } catch (e) {
    }
  }
  if (!shouldSkipVerification) {
    if (verifyForm) {
      verifyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = verifyEmailInput.value.trim();
        if (!email) return;
        if (isBannedEmail(email)) {
          verifyMsg.textContent = "Email ini diblokir dari akses aplikasi.";
          verifyMsg.className = "p-3 rounded-lg text-xs font-medium text-center bg-red-100 text-red-600 block mb-4";
          verifyMsg.classList.remove('hidden');
          verifyEmailInput.classList.add('border-red-500', 'focus:ring-red-500');
          return;
        }
        const originalBtnContent = verifyBtn.innerHTML;
        verifyBtn.disabled = true;
        verifyBtn.innerHTML = `<div class="loader-icon w-5 h-5 animate-spin"></div><span class="ml-2">Memeriksa...</span>`;
        verifyMsg.classList.add('hidden');
        verifyEmailInput.classList.remove('border-red-500', 'focus:ring-red-500');
        try {
          // Direct API call to bypass proxy issues
          const response = await fetch(`server/proxy.php?email`, {
            method: 'POST',
            cache: "no-store",
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({email: email})
          });
          const data = await response.json();
          if (verifyOrderAccess(data)) {
            localStorage.setItem('sulapfoto_verified_email', email);
            console.log('Email disimpan ke localStorage:', email);
            try {
              if (shouldRedirectVip(data)) {
                verifyMsg.textContent = "Akses VIP terdeteksi, mengalihkan ke VIP...";
                verifyMsg.className = "p-3 rounded-lg text-xs font-medium text-center bg-green-100 text-green-700 animate-pulse block mb-4";
                verifyMsg.classList.remove('hidden');
                window.location.href = 'vipacc';
                return;
              }
            } catch (e) {
            }
            // Session logic removed
            verifyMsg.textContent = "Akses Diterima! Mengalihkan...";
            verifyMsg.className = "p-3 rounded-lg text-xs font-medium text-center bg-green-100 text-green-700 animate-pulse block mb-4";
            verifyMsg.classList.remove('hidden');
            loadFaceApiScript();
            try {
              if (typeof window.backgroundMusic !== 'undefined' && window.backgroundMusic && typeof window.backgroundMusic.playing === 'function' && window.backgroundMusic.playing()) {
                window.backgroundMusic.pause();
              }
            } catch (e) {
            }
            monitorSession(email);
            if (typeof checkAppConfig === 'function') {
              checkAppConfig(true);
            }
            // Sync boost quota after manual login
            if (window.fetchBoostQuota) {
              window.fetchBoostQuota();
            }
            setTimeout(() => {
              verifyOverlay.classList.add('opacity-0', 'scale-110');
              bodyEl.classList.remove('overflow-hidden');
              setTimeout(() => verifyOverlay.style.display = 'none', 600);
            }, 1000);
          } else {
            throw new Error(data.message || "Email tidak terdaftar atau tidak memiliki akses.");
          }
        } catch (error) {
          console.error("Verification Error:", error);
          verifyMsg.textContent = error.message || "Terjadi kesalahan koneksi. Coba lagi.";
          verifyMsg.className = "p-3 rounded-lg text-xs font-medium text-center bg-red-100 text-red-600 block mb-4";
          verifyMsg.classList.remove('hidden');
          verifyEmailInput.classList.add('border-red-500', 'focus:ring-red-500');
          verifyForm.classList.add('translate-x-2');
          setTimeout(() => verifyForm.classList.remove('translate-x-2'), 100);
          setTimeout(() => verifyForm.classList.add('-translate-x-2'), 200);
          setTimeout(() => verifyForm.classList.remove('-translate-x-2'), 300);
          verifyBtn.disabled = false;
          verifyBtn.innerHTML = originalBtnContent;
          if (typeof lucide !== 'undefined') lucide.createIcons();
        }
      });
    }
  }
  document.addEventListener('click', async (e) => {
    const logoutBtn = e.target.closest('#btn-logout');
    if (logoutBtn) {
      console.log('Logout button clicked');
      e.preventDefault();
      e.stopPropagation();
      const originalContent = logoutBtn.innerHTML;
      logoutBtn.innerHTML = '<span class="animate-pulse">Keluar...</span>';
      logoutBtn.disabled = true;
      console.log('Starting logout process...');
      try {
        // Session cleanup removed
        localStorage.removeItem('sulapfoto_verified_email');
      } catch (err) {
        console.error("Logout cleanup error:", err);
      } finally {
        if (window.autoLogoutGroupChat) window.autoLogoutGroupChat();
        currentSession.email = null;
        if (verifyOverlay) {
          verifyOverlay.style.display = 'flex';
          setTimeout(() => {
            verifyOverlay.classList.remove('opacity-0', 'pointer-events-none');
          }, 50);
          try {
            if (typeof window.backgroundMusic !== 'undefined' && window.backgroundMusic && typeof window.backgroundMusic.playing === 'function' && !window.backgroundMusic.playing()) {
              window.backgroundMusic.play();
            }
          } catch (e) {
          }
        }
        if (bodyEl) bodyEl.classList.add('overflow-hidden');
        const sidebar = document.querySelector('aside');
        if (sidebar && window.innerWidth < 1024) {
          sidebar.classList.add('-translate-x-full');
          const overlay = document.getElementById('sidebar-overlay');
          if (overlay) overlay.classList.remove('visible');
        }
        if (logoutBtn) {
          logoutBtn.innerHTML = originalContent;
          logoutBtn.disabled = false;
        }
        if (verifyBtn) {
          verifyBtn.disabled = false;
          verifyBtn.innerHTML = verifyBtn.innerHTML.includes('Memeriksa') ? '<i data-lucide="log-in"></i><span class="ml-2">Masuk</span>' : verifyBtn.innerHTML;
        }
        if (verifyEmailInput) {
          verifyEmailInput.value = '';
          verifyEmailInput.disabled = false;
        }
        if (verifyForm) {
          verifyForm.classList.remove('translate-x-2', '-translate-x-2');
        }
        if (verifyMsg) {
          verifyMsg.classList.add('hidden');
        }
      }
    }
  });

  async function _checkQuotaInternal(count) {
    return true;
  }

  async function _updateQuotaInternal(count = 1) {
    // No-op
  }

  const fbReelUrls = []; // Not used
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    if (!navigator.onLine) {
      return Promise.reject(new Error("Tidak ada koneksi internet."));
    }
    const response = await originalFetch(...args);
    if (response.status === 401 || response.status === 403) {
      return Promise.reject(new Error(`Request failed: ${response.status}`));
    }
    return response;
  };

  function showQuotaLimitModal() {
    console.log("Quota limit modal disabled");
  }

  // POV Tangan logic moved to js/pov-tangan.js
  const videoModalBackdrop = document.getElementById('video-modal-backdrop');
  const videoModalContentWrapper = document.getElementById('video-modal-content-wrapper');

  function showVideoModal(videoSrc) {
    let finalVideoSrc = videoSrc.replace('muted=false', 'muted=true');
    if (!finalVideoSrc.includes('muted=')) {
      finalVideoSrc += '&muted=true';
    }
    const modalContentHTML = `
                <div id="video-modal-container" style="position:relative; padding-top:133.33%; border-radius: 0.75rem; overflow: hidden; background-color: black;">
                    <iframe
                        src="${finalVideoSrc}"
                        loading="lazy"
                        style="border:0; position:absolute; top:0; height:100%; width:100%;"
                        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                        >
                    </iframe>
                </div>
                <button id="video-modal-close-btn" class="absolute -top-2 -right-2 text-white bg-black/75 rounded-full p-1.5 hover:bg-black/90 transition-colors z-10 shadow-lg">
                    <i data-lucide="x" class="w-6 h-6"></i>
                </button>
            `;
    videoModalContentWrapper.innerHTML = modalContentHTML;
    lucide.createIcons();
    document.getElementById('video-modal-close-btn').addEventListener('click', hideVideoModal);
    videoModalBackdrop.classList.remove('opacity-0', 'pointer-events-none');
  }

  function hideVideoModal() {
    videoModalBackdrop.classList.add('opacity-0', 'pointer-events-none');
    setTimeout(() => {
      videoModalContentWrapper.innerHTML = '';
    }, 300);
  }

  if (videoModalBackdrop) {
    videoModalBackdrop.addEventListener('click', (e) => {
      if (e.target === videoModalBackdrop) {
        hideVideoModal();
      }
    });
  }
  const allTutorialButtons = document.querySelectorAll('.tutorial-btn');
  allTutorialButtons.forEach(button => {
    button.addEventListener('click', (event) => {
      const videoSrc = event.currentTarget.dataset.videoSrc;
      if (videoSrc && !videoSrc.includes('PLACEHOLDER')) {
        showVideoModal(videoSrc);
      } else {
        alert('Tutorial untuk fitur ini belum tersedia.');
      }
    });
  });
  const berandaTabAssistant = document.getElementById('beranda-tab-assistant');
  const berandaTabGroup = document.getElementById('beranda-tab-group');
  const berandaContentAssistant = document.getElementById('beranda-content-assistant');
  const berandaContentGroup = document.getElementById('beranda-content-group');
  const berandaDesktopQuery = window.matchMedia('(min-width: 1024px)');
  let berandaGroupInitialized = false;
  const sidebarToggle = document.getElementById('mobile-sidebar-toggle');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const sidebarToggleIcon = document.getElementById('sidebar-toggle-icon-wrapper');
  const sidebarTooltip = document.getElementById('sidebar-tooltip');
  const sidebar = document.querySelector('aside');
  const shouldShowTooltip = sidebarTooltip && !localStorage.getItem('sidebarTooltipShown');

  function setupSidebarAutoScroll() {
    const sidebarNav = document.querySelector('aside nav');
    const sidebarButtons = document.querySelectorAll('.sidebar-btn');
    if (!sidebarNav || sidebarButtons.length === 0) {
      console.error("Elemen sidebar untuk auto-scroll tidak ditemukan.");
      return;
    }
    sidebarButtons.forEach(button => {
      button.addEventListener('click', (event) => {
        if (sidebarNav.scrollHeight <= sidebarNav.clientHeight) {
          return;
        }
        const clickedButton = event.currentTarget;
        const navVisibleHeight = sidebarNav.clientHeight;
        const buttonTopInVisibleArea = clickedButton.offsetTop - sidebarNav.scrollTop;
        const buttonHeight = clickedButton.offsetHeight;
        const triggerZoneUp = navVisibleHeight * 0.40;
        const triggerZoneDown = navVisibleHeight * 0.60;
        if (buttonTopInVisibleArea > triggerZoneDown) {
          const isAtBottom = (sidebarNav.scrollHeight - sidebarNav.scrollTop - sidebarNav.clientHeight) < 1;
          if (!isAtBottom) {
            sidebarNav.scrollBy({
              top: 80,
              behavior: 'smooth'
            });
          }
        } else if ((buttonTopInVisibleArea + buttonHeight) < triggerZoneUp) {
          const isAtTop = sidebarNav.scrollTop === 0;
          if (!isAtTop) {
            sidebarNav.scrollBy({
              top: -80,
              behavior: 'smooth'
            });
          }
        }
      });
    });
  }

  setupSidebarAutoScroll();
  if (shouldShowTooltip) {
    setTimeout(() => {
      sidebarTooltip.classList.add('visible');
    }, 800);
    localStorage.setItem('sidebarTooltipShown', 'true');
  }
  if (sidebar && sidebarToggle && sidebarBackdrop && sidebarToggleIcon) {
    const openSidebar = () => {
      sidebar.classList.remove('-translate-x-full');
      sidebarBackdrop.classList.remove('opacity-0', 'pointer-events-none');
      sidebarToggle.classList.add('translate-x-64');
      sidebarToggleIcon.classList.add('rotate-180');
    };
    const closeSidebar = () => {
      sidebar.classList.add('-translate-x-full');
      sidebarBackdrop.classList.add('opacity-0', 'pointer-events-none');
      sidebarToggle.classList.remove('translate-x-64');
      sidebarToggleIcon.classList.remove('rotate-180');
    };
    const toggleSidebar = () => {
      if (sidebar.classList.contains('-translate-x-full')) {
        openSidebar();
      } else {
        closeSidebar();
      }
    };
    sidebarToggle.addEventListener('click', () => {
      if (sidebarTooltip && sidebarTooltip.classList.contains('visible')) {
        sidebarTooltip.classList.remove('visible');
      }
      toggleSidebar();
    });
    sidebarBackdrop.addEventListener('click', closeSidebar);
    sidebar.querySelectorAll('.sidebar-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.innerWidth < 768 && !sidebar.classList.contains('-translate-x-full')) {
          closeSidebar();
        }
      });
    });
  }

  // Chat helpers removed
  async function getVipStatusForCurrentSession() {
    return false;
  }

  async function checkUserIsBlocked() {
    if (!currentSession.email) return false;
    try {
      const safeEmail = currentSession.email.replace(/\./g, '_');
      const snapshot = await sessionDb.ref('sessions/' + safeEmail + '/isblock').once('value');
      if (snapshot.exists() && snapshot.val() === true) {
        return true;
      }
      const vipSnapshot = await sessionDb.ref('sessions/' + safeEmail + '/isblock').once('value');
      if (vipSnapshot.exists() && vipSnapshot.val() === true) {
        return true;
      }
      return false;
    } catch (e) {
      console.error('Error checking block status:', e);
      return false;
    }
  }

  async function loadUsernameAndProvinceFromSession() {
    if (!currentSession.email) return;
    try {
      const safeEmail = currentSession.email.replace(/\./g, '_');
      const snapshot = await sessionDb.ref('sessions/' + safeEmail).once('value');
      const sessionData = snapshot.val();
      if (sessionData) {
        if (sessionData.username && sessionData.province) {
          return {username: sessionData.username, province: sessionData.province};
        }
        if (sessionData.groupChatInfo && sessionData.groupChatInfo.name && sessionData.groupChatInfo.province) {
          await sessionDb.ref('sessions/' + safeEmail).update({
            username: sessionData.groupChatInfo.name,
            province: sessionData.groupChatInfo.province
          });
          return {
            username: sessionData.groupChatInfo.name,
            province: sessionData.groupChatInfo.province
          };
        }
      }
    } catch (e) {
      console.error('Error loading username and province from session:', e);
    }
    return null;
  }

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
  const getUserColor = (name, province, isAdmin) => {
    if (isAdmin) return adminColor;
    const userKey = `${name}-${province}`;
    if (userColors[userKey]) {
      return userColors[userKey];
    }
    let hash = 0;
    for (let i = 0; i < userKey.length; i++) {
      hash = userKey.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colorIndex = Math.abs(hash % colorPalette.length);
    const color = colorPalette[colorIndex];
    userColors[userKey] = color;
    return color;
  };
  const provinceList = ["Aceh", "Bali", "Banten", "Bengkulu", "DI Yogyakarta", "DKI Jakarta", "Gorontalo", "Jambi", "Jawa Barat", "Jawa Tengah", "Jawa Timur", "Kalimantan Barat", "Kalimantan Selatan", "Kalimantan Tengah", "Kalimantan Timur", "Kalimantan Utara", "Kep. Bangka Belitung", "Kep. Riau", "Lampung", "Maluku", "Maluku Utara", "Nusa Tenggara Barat", "Nusa Tenggara Timur", "Papua", "Papua Barat", "Riau", "Sulawesi Barat", "Sulawesi Selatan", "Sulawesi Tengah", "Sulawesi Tenggara", "Sulawesi Utara", "Sumatera Barat", "Sumatera Selatan", "Sumatera Utara"];
  const chatSound = new Howl({
    src: ['https://cdn.jsdelivr.net/gh/syifarahmat/sulap.foto@a5c9c446bcda2d5a664cd1c6a222f270acbd8678/assets/chat.mp3'],
    volume: 1,
    preload: true
  });
  if (window.initChatGlobalNotification) {
    // Feature removed or pending MySQL implementation
  }

  function showBerandaDual() {
    if (berandaTabAssistant && berandaTabGroup) {
      berandaTabAssistant.classList.add('active');
      berandaTabGroup.classList.add('active');
    }
    if (berandaContentAssistant && berandaContentGroup) {
      berandaContentAssistant.classList.remove('hidden');
      berandaContentGroup.classList.remove('hidden');
    }
    if (window.initChatGroup && !berandaGroupInitialized) {
      window.initChatGroup({
        sessionDb,
        database,
        currentSession,
        getUserColor,
        checkUserIsBlocked,
        getVipStatusForCurrentSession,
        maskEmail,
        API_KEY,
        CHAT_URL
      });
      berandaGroupInitialized = true;
    }
  }

  function switchBerandaTab(tabName) {
    if (berandaDesktopQuery.matches) {
      showBerandaDual();
      return;
    }
    const isAssistantActive = tabName === 'assistant';
    if (berandaTabAssistant && berandaTabGroup) {
      berandaTabAssistant.classList.toggle('active', isAssistantActive);
      berandaTabGroup.classList.toggle('active', !isAssistantActive);
    }
    if (berandaContentAssistant && berandaContentGroup) {
      berandaContentAssistant.classList.toggle('hidden', !isAssistantActive);
      berandaContentGroup.classList.toggle('hidden', isAssistantActive);
    }
    if (tabName === 'group' && window.initChatGroup) {
      window.initChatGroup({
        sessionDb,
        database,
        currentSession,
        getUserColor,
        checkUserIsBlocked,
        getVipStatusForCurrentSession,
        maskEmail,
        API_KEY,
        CHAT_URL
      });
      berandaGroupInitialized = true;
    }
  }

  if (berandaTabAssistant) {
    berandaTabAssistant.addEventListener('click', () => switchBerandaTab('assistant'));
  }
  if (berandaTabGroup) {
    berandaTabGroup.addEventListener('click', () => switchBerandaTab('group'));
  }
  if (berandaDesktopQuery.matches) {
    showBerandaDual();
  } else {
    switchBerandaTab('group');
  }
  berandaDesktopQuery.addEventListener('change', (event) => {
    if (event.matches) {
      showBerandaDual();
    } else {
      switchBerandaTab('assistant');
    }
  });
  const backgroundMusic = new Howl({
    src: ['https://cdn.jsdelivr.net/gh/syifarahmat/sulap.foto@a5c9c446bcda2d5a664cd1c6a222f270acbd8678/assets/music.mp3'],
    volume: 1,
    loop: true,
    html5: true,
  });
  window.backgroundMusic = backgroundMusic;
  const musicToggleBtn = document.getElementById('music-toggle-btn');
  let musicInitialized = false;

  function updateMusicIcon(isPlaying) {
    if (!musicToggleBtn) return;
    musicToggleBtn.innerHTML = isPlaying
      ? `<i data-lucide="pause" class="w-5 h-5 fill-current group-hover:scale-110 transition-transform"></i>`
      : `<i data-lucide="play" class="w-5 h-5 fill-current group-hover:scale-110 transition-transform"></i>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function toggleMusic() {
    musicInitialized = true;
    if (backgroundMusic.playing()) {
      backgroundMusic.pause();
    } else {
      backgroundMusic.play();
    }
  }

  backgroundMusic.on('play', () => {
    updateMusicIcon(true);
  });
  backgroundMusic.on('pause', () => {
    updateMusicIcon(false);
  });
  if (musicToggleBtn) {
    musicToggleBtn.addEventListener('click', toggleMusic);
  }
  Howler.html5PoolSize = 50;
  const hoverSound = new Howl({
    src: ['https://cdn.jsdelivr.net/gh/syifarahmat/sulap.foto@a5c9c446bcda2d5a664cd1c6a222f270acbd8678/assets/hover.mp3'],
    volume: 0.6,
    preload: true
  });
  const clickSound = new Howl({
    src: ['https://cdn.jsdelivr.net/gh/syifarahmat/sulap.foto@a5c9c446bcda2d5a664cd1c6a222f270acbd8678/assets/click.mp3'],
    volume: 1,
    preload: true
  });
  const doneSound = new Howl({
    src: ['https://cdn.jsdelivr.net/gh/syifarahmat/sulap.foto@a5c9c446bcda2d5a664cd1c6a222f270acbd8678/assets/done.mp3'],
    volume: 1,
    preload: true
  });
  const errorSound = new Howl({
    src: ['https://cdn.jsdelivr.net/gh/syifarahmat/sulap.foto@a5c9c446bcda2d5a664cd1c6a222f270acbd8678/assets/error.mp3'],
    volume: 1,
    preload: true
  });
  // Crop Foto Module Initialization
  if (window.initCropFoto) {
    window.initCropFoto({
      document: document,
      setupImageUpload: setupImageUpload,
      lucide: window.lucide,
      doneSound: doneSound,
      errorSound: errorSound
    });
  }
  let lastHoverTime = 0;
  document.querySelectorAll('.sidebar-btn').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      const now = Date.now();
      if (now - lastHoverTime > 80) {
        hoverSound.stop();
        hoverSound.play();
        lastHoverTime = now;
      }
    });
    btn.addEventListener('click', () => {
      clickSound.stop();
      clickSound.play();
    });
  });
  window.getApiErrorMessage = async function (response) {
    try {
      const errorBody = await response.json();
      const message = errorBody.error?.message || errorBody.message || '';
      if (response.status === 401 || response.status === 403) {
        return message || 'Anda tidak bisa menggunakan fitur ini karena belum login, silahkan klik tombol signin/login/masuk di kanan atas halaman ini.';
      }
      if (message.includes("Method doesn't allow unregistered callers")) {
        return 'Anda tidak bisa menggunakan fitur ini karena belum login, silahkan klik tombol signin/login/masuk di kanan atas halaman ini.';
      }
      if (message.toLowerCase().includes("quota") || message.toLowerCase().includes("exceeded")) {
        return "Kuota API habis. Coba lagi nanti.";
      }
      return message || `Kode ${response.status}: Gagal Generate karena melanggar kebijakan. coba foto lain atau ganti intruksi..`;
    } catch (e) {
      if (response.status === 401 || response.status === 403) {
        return 'Anda tidak bisa menggunakan fitur ini karena belum login, silahkan klik tombol signin/login/masuk di kanan atas halaman ini.';
      }
      return `Error ${response.status}: ${response.statusText || 'Terjadi kesalahan tidak diketahui.'}`;
    }
  }

  function getAspectRatioClass(ratio) {
    const mapping = {
      '1:1': 'aspect-square',
      '3:4': 'aspect-[3/4]',
      '4:3': 'aspect-[4/3]',
      '16:9': 'aspect-video',
      '9:16': 'aspect-[9/16]'
    };
    return mapping[ratio] || 'aspect-square';
  }

  function setupOptionButtons(container, isCheckbox = false) {
    if (!container) return;
    container.addEventListener('click', (e) => {
      const clickedButton = e.target.closest('button');
      if (clickedButton && container.contains(clickedButton)) {
        if (isCheckbox) {
          clickedButton.classList.toggle('selected');
        } else {
          Array.from(container.children).forEach(btn => btn.classList.remove('selected'));
          clickedButton.classList.add('selected');
        }
      }
    });
  }

  async function downloadDataURI(dataURI, filename) {
    try {
      const response = await fetch(dataURI);
      const blob = await response.blob();
      saveAs(blob, filename);
    } catch (error) {
      console.error("Gagal mengunduh file:", error);
      window.open(dataURI, '_blank');
    }
  }

  document.body.addEventListener('click', function (e) {
    const downloadButton = e.target.closest('.download-btn:not(.crsl-open-download-btn)');
    if (downloadButton) {
      e.preventDefault();
      const dataURI = downloadButton.getAttribute('href');
      const filename = downloadButton.getAttribute('download') || 'sulap-foto.png';
      if (dataURI && dataURI !== '#') downloadDataURI(dataURI, filename);
    }
    const crslIndividualDownloadBtn = e.target.closest('.crsl-individual-download-btn');
    if (crslIndividualDownloadBtn) {
      e.preventDefault();
      const dataURI = crslIndividualDownloadBtn.dataset.src;
      const filename = crslIndividualDownloadBtn.dataset.filename;
      if (dataURI && filename) downloadDataURI(dataURI, filename);
    }
  });
  const tabMapping = {
    'beranda': 'beranda',
    'product': 'product-photography',
    'vto': 'virtual-try-on',
    'fashion': 'fashion',
    'pre-wedding': 'pre-wedding',
    'model': 'model-generator',
    'photographer-rental': 'photographer-rental',
    'desain-rumah': 'desain-rumah',
    'edit-foto': 'edit-foto',
    'perbaiki-foto': 'perbaiki-foto',
    'buat-banner': 'buat-banner',
    'bikin-carousel': 'bikin-carousel',
    'sketch-to-image': 'sketch-to-image',
    'art-karikatur': 'art-karikatur',
    'auto-rapi': 'auto-rapi',
    'desain-mockup': 'desain-mockup',
    'foto-miniatur': 'foto-miniatur',
    'barbershop': 'barbershop',
    'face-swap': 'face-swap',
    'foto-artis': 'foto-artis',
    'hapus-bg': 'hapus-bg',
    'hapus-objek': 'hapus-objek',
    'perluas-foto': 'perluas-foto',
    'pov-tangan': 'pov-tangan',
    'kamar-pas': 'kamar-pas',
    'retouch-wajah': 'retouch-wajah',
    'text-to-image': 'text-to-image',
    'business-card': 'business-card',
    'graduation-photo': 'graduation-photo',
    'create-logo': 'create-logo',
    'create-mascot': 'create-mascot',
    'photo-collage': 'photo-collage',
    'foto-polaroid': 'foto-polaroid',
    'video-thumbnail': 'video-thumbnail',
    'potret-cinta': 'potret-cinta',
    'size-produk': 'size-produk',
    'watermark': 'watermark',
    'age-filter': 'age-filter',
    'pov-selfie': 'pov-selfie',
    'wedding-2': 'wedding-2',
    'crop-foto': 'crop-foto',
  };

  function startDesainMockupIntent() {
    switchTab('desain-mockup', () => {
    });
  }

  const allSidebarBtns = document.querySelectorAll('.sidebar-btn');

  function switchTab(tabKey, callback = () => {
  }) {
    window.scrollTo({top: 0, behavior: 'smooth'});
    const contentId = `content-${tabMapping[tabKey]}`;
    const newContent = document.getElementById(contentId);
    if (!newContent) return;
    const activeContent = document.querySelector('.tab-content-pane.is-active');
    if (activeContent === newContent) {
      callback();
      return;
    }
    allSidebarBtns.forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-${tabMapping[tabKey]}`)?.classList.add('active');
    const mobileNavItem = document.getElementById(`mobile-nav-${tabMapping[tabKey]}`);
    if (activeContent) {
      // Check if animations are disabled
      const style = window.getComputedStyle(activeContent);
      const isAnimationDisabled = style.animationName === 'none' || style.animationDuration === '0s';
      if (isAnimationDisabled) {
        activeContent.classList.remove('is-active', 'is-exiting');
        activeContent.classList.add('hidden');
        newContent.classList.remove('hidden');
        newContent.classList.add('is-active');
        callback();
      } else {
        activeContent.classList.add('is-exiting');
        activeContent.addEventListener('animationend', () => {
          activeContent.classList.remove('is-active', 'is-exiting');
          activeContent.classList.add('hidden');
          newContent.classList.remove('hidden');
          newContent.classList.add('is-active');
          callback();
        }, {once: true});
      }
    } else {
      newContent.classList.remove('hidden');
      newContent.classList.add('is-active');
      callback();
    }
  }

  window.switchTab = switchTab;
  for (const key in tabMapping) {
    const tabElement = document.getElementById(`tab-${tabMapping[key]}`);
    if (tabElement && !tabElement.hasAttribute('data-listener-added')) {
      tabElement.addEventListener('click', () => switchTab(key));
      tabElement.setAttribute('data-listener-added', 'true');
    }
  }
  for (const key in tabMapping) {
    if (key !== 'photographer-rental' && key !== 'model' && key !== 'perbaiki-foto' && key !== 'vto') {
      document.getElementById(`tab-${tabMapping[key]}`)?.addEventListener('click', () => switchTab(key));
    }
  }
  const modelSubTabs = {
    'subtab-model-create': 'create',
    'subtab-model-repose': 'repose',
    'subtab-model-angle': 'angle'
  };
  Object.entries(modelSubTabs).forEach(([id, tabKey]) => {
    document.getElementById(id)?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('active'));
      switchTab('model');
      switchModelTab(tabKey);
      e.currentTarget.classList.add('active');
    });
  });
  const productToggle = document.getElementById('nav-product-toggle');
  const productSubmenu = document.getElementById('submenu-product');
  if (productToggle && productSubmenu) {
    productToggle.addEventListener('click', (e) => {
      e.preventDefault();
      const isOpen = productToggle.classList.toggle('open');
      productSubmenu.classList.toggle('hidden', !isOpen);
      if (isOpen) {
        switchTab('vto');
        switchVtoTab('product-only');
      }
    });
    const productSubTabs = {
      'subtab-product-only': 'product-only',
      'subtab-product-model': 'product-model'
    };
    Object.entries(productSubTabs).forEach(([id, subKey]) => {
      document.getElementById(id)?.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('active'));
        switchTab('vto');
        switchVtoTab(subKey);
        e.currentTarget.classList.add('active');
      });
    });
  }
  const photographerSubTabs = {
    'subtab-baby': 'baby',
    'subtab-kids': 'kids',
    'subtab-umrah': 'umrah',
    'subtab-passport': 'passport',
    'subtab-maternity': 'maternity'
  };
  Object.entries(photographerSubTabs).forEach(([id, tabKey]) => {
    document.getElementById(id)?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('active'));
      switchTab('photographer-rental');
      switchPhotographerTab(tabKey);
      e.currentTarget.classList.add('active');
    });
  });
  document.getElementById(`tab-${tabMapping['foto-artis']}`)?.addEventListener('click', () => switchTab('foto-artis'));
  document.getElementById(`tab-${tabMapping['hapus-bg']}`)?.addEventListener('click', () => switchTab('hapus-bg'));
  document.getElementById(`tab-${tabMapping['pov-selfie']}`)?.addEventListener('click', () => switchTab('pov-selfie'));
  const universalModal = document.getElementById('universal-modal');
  const imagePreviewModal = document.getElementById('image-preview-modal');
  let previewModalImages = [];
  let previewModalIndex = -1;
  let activePreviewModal = 'default';

  function collectPreviewSources() {
    const sources = [];
    const addSource = (url) => {
      if (url && !sources.includes(url)) sources.push(url);
    };
    document.querySelectorAll('.view-btn[data-img-src]').forEach(btn => addSource(btn.dataset.imgSrc));
    document.querySelectorAll('[onclick*="openTiImagePreview"]').forEach(el => {
      const handler = el.getAttribute('onclick') || '';
      const match = handler.match(/openTiImagePreview\('([^']+)'\)/);
      if (match) addSource(match[1]);
    });
    return sources;
  }

  function updatePreviewNavButtons() {
    const prevBtnId = activePreviewModal === 'ti' ? 'ti-preview-prev' : 'preview-modal-prev';
    const nextBtnId = activePreviewModal === 'ti' ? 'ti-preview-next' : 'preview-modal-next';
    const prevBtn = document.getElementById(prevBtnId);
    const nextBtn = document.getElementById(nextBtnId);
    const hasMultiple = previewModalImages.length > 1;
    const atStart = previewModalIndex <= 0;
    const atEnd = previewModalIndex >= previewModalImages.length - 1;
    if (prevBtn) {
      prevBtn.disabled = !hasMultiple || atStart;
      prevBtn.classList.toggle('opacity-40', !hasMultiple || atStart);
    }
    if (nextBtn) {
      nextBtn.disabled = !hasMultiple || atEnd;
      nextBtn.classList.toggle('opacity-40', !hasMultiple || atEnd);
    }
  }

  function showPreviewAt(index) {
    if (!previewModalImages.length) return;
    const nextIndex = Math.max(0, Math.min(previewModalImages.length - 1, index));
    previewModalIndex = nextIndex;
    const url = previewModalImages[previewModalIndex];
    if (activePreviewModal === 'ti') {
      document.getElementById('ti-image-preview-content').src = url;
    } else {
      document.getElementById('preview-modal-img').src = url;
    }
    updatePreviewNavButtons();
  }

  function setPreviewState(url, modalType) {
    activePreviewModal = modalType;
    previewModalImages = collectPreviewSources();
    if (!previewModalImages.length && url) previewModalImages = [url];
    previewModalIndex = previewModalImages.indexOf(url);
    if (previewModalIndex === -1 && url) {
      previewModalImages.push(url);
      previewModalIndex = previewModalImages.length - 1;
    }
    updatePreviewNavButtons();
  }

  function hideAndClearModal() {
    universalModal.classList.remove('visible');
    setTimeout(() => {
      const modalBody = document.getElementById('modal-body');
      const iframe = modalBody.querySelector('iframe');
      if (iframe) {
        iframe.src = '';
      }
      modalBody.innerHTML = '';
    }, 300);
  }

  function showContentModal(title, bodyHTML) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHTML;
    universalModal.classList.add('visible');
  }

  document.getElementById('close-modal-btn').addEventListener('click', hideAndClearModal);
  universalModal.addEventListener('click', (e) => {
    if (e.target === universalModal) {
      hideAndClearModal();
    }
  });

  function showImagePreview(imgSrc) {
    document.getElementById('preview-modal-img').src = imgSrc;
    imagePreviewModal.classList.remove('opacity-0', 'pointer-events-none');
    setPreviewState(imgSrc, 'default');
  }

  function hideImagePreview() {
    imagePreviewModal.classList.add('opacity-0', 'pointer-events-none');
    document.getElementById('preview-modal-img').src = "";
  }

  document.getElementById('preview-modal-close').addEventListener('click', hideImagePreview);
  document.getElementById('preview-modal-prev')?.addEventListener('click', () => showPreviewAt(previewModalIndex - 1));
  document.getElementById('preview-modal-next')?.addEventListener('click', () => showPreviewAt(previewModalIndex + 1));
  imagePreviewModal.addEventListener('click', (e) => {
    if (e.target === imagePreviewModal) hideImagePreview();
  });
  document.body.addEventListener('click', (e) => {
    const viewButton = e.target.closest('.view-btn');
    if (viewButton && viewButton.dataset.imgSrc) showImagePreview(viewButton.dataset.imgSrc);
  });

  async function convertHeicToJpg(file) {
    const isHeic = file.name.toLowerCase().endsWith('.heic') || file.type.toLowerCase() === 'image/heic' || file.type.toLowerCase() === 'image/heif';
    if (isHeic) {
      console.log("HEIC file detected, converting...");
      try {
        const conversionResult = await heic2any({
          blob: file,
          toType: "image/png",
        });
        const finalBlob = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;
        const originalName = file.name.split('.').slice(0, -1).join('.');
        const jpegFile = new File([finalBlob], `${originalName}.png`, {type: 'image/png'});
        console.log("Conversion successful.");
        return jpegFile;
      } catch (error) {
        console.error("HEIC conversion failed:", error);
        alert("Gagal mengonversi file HEIC. File mungkin rusak atau tidak didukung.");
        throw error;
      }
    } else {
      return file;
    }
  }

  window.convertHeicToJpg = convertHeicToJpg;

  function base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], {type: mimeType});
  }

  window.base64ToBlob = base64ToBlob;

  function showModernPopup({title, message, actionText} = {}) {
    const existing = document.getElementById('sf-popup-backdrop');
    if (existing) existing.remove();
    const backdrop = document.createElement('div');
    backdrop.id = 'sf-popup-backdrop';
    backdrop.className = 'sf-popup-backdrop';
    backdrop.innerHTML = `
                    <div class="sf-popup-card" role="dialog" aria-modal="true">
                        <div class="sf-popup-header">
                            <div class="sf-popup-title">
                                <span class="sf-popup-icon">
                                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <path d="M12 8h.01"></path>
                                        <path d="M11 12h1v4h1"></path>
                                    </svg>
                                </span>
                                <span>${title || 'Perhatian'}</span>
                            </div>
                            <button class="sf-popup-close" type="button" aria-label="Tutup">
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M18 6 6 18"></path>
                                    <path d="m6 6 12 12"></path>
                                </svg>
                            </button>
                        </div>
                        <div class="sf-popup-body">${message || ''}</div>
                        <div class="sf-popup-actions">
                            <button class="sf-popup-btn" type="button">${actionText || 'Mengerti'}</button>
                        </div>
                    </div>
                `;
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => {
      backdrop.classList.add('active');
    });
    const closePopup = () => {
      backdrop.classList.remove('active');
      setTimeout(() => backdrop.remove(), 200);
      document.body.style.overflow = '';
    };
    document.body.style.overflow = 'hidden';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closePopup();
    });
    const closeBtn = backdrop.querySelector('.sf-popup-close');
    const actionBtn = backdrop.querySelector('.sf-popup-btn');
    if (closeBtn) closeBtn.addEventListener('click', closePopup);
    if (actionBtn) actionBtn.addEventListener('click', closePopup);
  }

  function showUploadLimitPopup() {
    showModernPopup({
      title: 'Ukuran Terlalu Besar',
      message: 'Ukuran file maksimal 15MB. Silakan pilih gambar lebih kecil.',
      actionText: 'Pilih Ulang'
    });
  }

  window.showModernPopup = showModernPopup;
  window.showUploadLimitPopup = showUploadLimitPopup;
  const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

  function setupImageUpload(input, uploadArea, onFile) {
    async function handleFile(file) {
      if (file) {
        if (file.size > MAX_UPLOAD_BYTES) {
          showUploadLimitPopup();
          if (input) input.value = '';
          return;
        }
        try {
          const processedFile = await convertHeicToJpg(file);
          const reader = new FileReader();
          reader.onload = (e) => {
            const parts = e.target.result.split(',');
            const mimeType = parts[0].match(/:(.*?);/)[1];
            const base64 = parts[1];
            onFile({base64, mimeType, dataUrl: e.target.result});
          };
          reader.readAsDataURL(processedFile);
        } catch (error) {
          console.error("Error processing file:", error);
        }
      }
    }

    input.addEventListener('change', (event) => {
      setTimeout(() => {
        if (event.target.files && event.target.files.length > 0) {
          handleFile(event.target.files[0]);
        }
      }, 100);
    });
    if (uploadArea) {
      ['dragover', 'drop', 'dragleave'].forEach(eventName => {
        uploadArea.addEventListener(eventName, e => {
          e.preventDefault();
          e.stopPropagation();
        });
      });
      uploadArea.addEventListener('dragover', () => uploadArea.classList.add('border-teal-500'));
      uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('border-teal-500'));
      uploadArea.addEventListener('drop', (e) => {
        uploadArea.classList.remove('border-teal-500');
        handleFile(e.dataTransfer.files[0]);
      });
    }
  }

  if (window.initProdukModel) {
    window.initProdukModel({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      getApiKey: () => API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
  }
  // Initialize Buat Model Module
  if (window.initBuatModel) {
    window.initBuatModel({
      document,
      setupImageUpload,
      setupOptionButtons,
      updateSliderProgress,
      getAspectRatioClass,
      lucide,
      API_KEY,
      GENERATE_URL,
      CHAT_URL,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
  }
  // Initialize Ubah Pose Module
  if (window.initUbahPose) {
    window.initUbahPose({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
  }
  // Initialize Ubah Angle Module
  if (window.initUbahAngle) {
    window.initUbahAngle({
      document,
      setupImageUpload,
      setupOptionButtons,
      updateSliderProgress,
      getAspectRatioClass,
      lucide,
      API_KEY,
      GENERATE_URL,
      CHAT_URL,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
  }
  // Initialize Wedding 2.0 Module
  if (window.initWedding2) {
    window.initWedding2({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      base64ToBlob,
      doneSound,
      errorSound
    });
  }
  // Initialize Baby Born Module
  if (window.initBabyBorn) {
    window.sfBabyModule = window.initBabyBorn({
      document,
      setupImageUpload,
      setupOptionButtons,
      generatePhotographerImage,
      lucide
    });
  }
  // Initialize Kids Module
  if (window.initKids) {
    window.sfKidsModule = window.initKids({
      document,
      setupImageUpload,
      setupOptionButtons,
      generatePhotographerImage
    });
  }
  // Initialize Umrah Module
  if (window.initUmrah) {
    window.sfUmrahModule = window.initUmrah({
      document,
      setupImageUpload,
      setupOptionButtons,
      generatePhotographerImage
    });
  }
  // Initialize Passport Module
  if (window.initPassport) {
    window.sfPassportModule = window.initPassport({
      document,
      setupImageUpload,
      setupOptionButtons,
      generatePhotographerImage
    });
  }
  // Initialize Maternity Module
  if (window.initMaternity) {
    window.sfMaternityModule = window.initMaternity({
      document,
      setupImageUpload,
      setupOptionButtons,
      generatePhotographerImage
    });
  }
  // Initialize Buat Logo Module
  if (window.initBuatLogo) {
    window.initBuatLogo({
      document,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      getApiKey: () => API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
  }
  if (window.initFotoKolase) {
    window.initFotoKolase({
      document,
      lucide,
      convertHeicToJpg,
      base64ToBlob,
      GENERATE_URL,
      API_KEY,
      getApiErrorMessage,
      doneSound
    });
  }
  // Initialize Foto Polaroid Module
  if (window.initFotoPolaroid) {
    window.initFotoPolaroid({
      document,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      convertHeicToJpg,
      getApiErrorMessage,
      doneSound,
      errorSound,
      switchTab,
      API_KEY,
      GENERATE_URL
    });
  }
  if (window.initHapusObjek) {
    window.initHapusObjek();
  }
  // Upgrade VIP Modal Logic
  const upgradeVipModal = document.getElementById('upgrade-vip-modal');
  const closeUpgradeVipModalBtn = document.getElementById('upgrade-vip-modal-close');
  if (upgradeVipModal && closeUpgradeVipModalBtn) {
    closeUpgradeVipModalBtn.addEventListener('click', () => {
      upgradeVipModal.classList.remove('active');
    });
    upgradeVipModal.addEventListener('click', (e) => {
      if (e.target === upgradeVipModal) {
        upgradeVipModal.classList.remove('active');
      }
    });
  }

  function showUpgradeVipPopup() {
    if (upgradeVipModal) {
      upgradeVipModal.classList.add('active');
    } else if (window.showModernPopup) {
      window.showModernPopup({
        title: 'Fitur VIP',
        message: 'Fitur ini khusus untuk pengguna VIP. Upgrade sekarang untuk akses penuh!',
        actionText: 'Upgrade ke VIP'
      });
    } else {
      alert("Fitur ini khusus VIP. Silakan upgrade!");
    }
  }

  window.showBoostModeVipOnlyPopup = function () {
    const existing = document.getElementById('sf-popup-backdrop');
    if (existing) existing.remove();
    const backdrop = document.createElement('div');
    backdrop.id = 'sf-popup-backdrop';
    backdrop.className = 'sf-popup-backdrop';
    backdrop.innerHTML = `
                    <div class="sf-popup-card" role="dialog" aria-modal="true">
                        <div class="sf-popup-header" style="background: linear-gradient(135deg, #1f2937, #0f172a); border-bottom: 1px solid rgba(255,255,255,0.08);">
                            <div class="sf-popup-title" style="color: #f8fafc;">
                                <span class="sf-popup-icon" style="width: 28px; height: 28px; border-radius: 10px; background: rgba(251, 191, 36, 0.18); color: #fbbf24;">
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                                    </svg>
                                </span>
                                <span>Boost Mode</span>
                            </div>
                            <button class="sf-popup-close" type="button" aria-label="Tutup" style="color: #cbd5f5;">
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M18 6 6 18"></path>
                                    <path d="m6 6 12 12"></path>
                                </svg>
                            </button>
                        </div>
                        <div class="sf-popup-body" style="padding: 12px 18px 6px; color: #475569; font-size: 0.85rem;">Mohon maaf. Fitur boost saat ini hanya untuk pengguna VIP.</div>
                        <div class="sf-popup-actions" style="padding: 8px 18px 16px;">
                            <a class="sf-popup-btn" href="https://klikcerdas.id/p/sulap-foto-vip-by-ichsanlabs" target="_blank" rel="noopener" style="padding: 6px 12px; font-size: 0.8rem; background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #1f2937; box-shadow: 0 6px 12px rgba(245, 158, 11, 0.25);">Upgrade ke VIP</a>
                        </div>
                    </div>
                `;
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => {
      backdrop.classList.add('active');
    });
    const closePopup = () => {
      backdrop.classList.remove('active');
      setTimeout(() => backdrop.remove(), 200);
      document.body.style.overflow = '';
    };
    document.body.style.overflow = 'hidden';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closePopup();
    });
    const closeBtn = backdrop.querySelector('.sf-popup-close');
    const actionBtn = backdrop.querySelector('.sf-popup-btn');
    if (closeBtn) closeBtn.addEventListener('click', closePopup);
    if (actionBtn) actionBtn.addEventListener('click', closePopup);
  };
  // VIP Blocking Logic
  const vipGenerateButtonIds = [
    'ti-generate-btn', // Buat Gambar
    'bc-generate-btn', // Kartu Nama
    'cl-generate-btn', // Buat Logo
    'bm-generate-btn', // Buat Mascot
    'fk-generate-btn', // Foto Kolase
    'fp-generate-btn', // Foto Polaroid
    'wm-generate-btn', // Watermark
    'crop-generate-btn', // Crop Foto
    'so-generate-btn', // Size Objek
    'ho-generate-btn', // Hapus Objek
    'gp-generate-btn', // Foto Wisuda
    'vt-generate-btn', // Video Thumbnail
    'af-generate-btn', // Age Filter
    'pov-selfie-generate-btn', // POV Selfie
  ];
  if (!window.IS_VIP_APP) {
    vipGenerateButtonIds.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        // Use capture phase to intercept click before other listeners
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          showUpgradeVipPopup();
        }, true);
      }
    });
  }
  const sfTabBaby = document.getElementById('sf-tab-baby');
  const sfTabKids = document.getElementById('sf-tab-kids');
  const sfTabUmrah = document.getElementById('sf-tab-umrah');
  const sfTabPassport = document.getElementById('sf-tab-passport');
  const sfTabMaternity = document.getElementById('sf-tab-maternity');
  const sfContentBaby = document.getElementById('sf-content-baby');
  const sfContentKids = document.getElementById('sf-content-kids');
  const sfContentUmrah = document.getElementById('sf-content-umrah');
  const sfContentPassport = document.getElementById('sf-content-passport');
  const sfContentMaternity = document.getElementById('sf-content-maternity');

  function switchPhotographerTab(tabName) {
    const tabs = {
      'baby': {btn: sfTabBaby, content: sfContentBaby},
      'kids': {btn: sfTabKids, content: sfContentKids},
      'umrah': {btn: sfTabUmrah, content: sfContentUmrah},
      'passport': {btn: sfTabPassport, content: sfContentPassport},
      'maternity': {btn: sfTabMaternity, content: sfContentMaternity}
    };
    for (const key in tabs) {
      const isActive = (key === tabName);
      if (tabs[key].btn) tabs[key].btn.classList.toggle('selected', isActive);
      if (tabs[key].content) tabs[key].content.classList.toggle('hidden', !isActive);
    }
  }

  async function generatePhotographerImage(type, prompt, imageData, aspectRatio, refImageData = null) {
    const resultsContainer = document.getElementById(`sf-${type}-results-container`);
    const resultsGrid = document.getElementById(`sf-${type}-results-grid`);
    const generateBtn = document.getElementById(`sf-${type}-generate-btn`);
    const originalBtnHTML = generateBtn.innerHTML;
    generateBtn.disabled = true;
    generateBtn.innerHTML = `<div class="loader-icon w-5 h-5 rounded-full"></div><span class="ml-2">Membuat Foto...</span>`;
    const aspectClass = getAspectRatioClass(aspectRatio);
    resultsContainer.classList.remove('hidden');
    resultsGrid.innerHTML = '';
    const numVariations = 4;
    for (let i = 1; i <= numVariations; i++) {
      const card = document.createElement('div');
      card.id = `sf-${type}-card-${i}`;
      card.className = `card overflow-hidden transition-all ${aspectClass} bg-gray-100 flex items-center justify-center`;
      card.innerHTML = `<div class="loader-icon w-10 h-10"></div>`;
      resultsGrid.appendChild(card);
    }
    lucide.createIcons();
    const generationPromises = Array.from({length: numVariations}, (_, i) =>
      generateSingleSFImage(i + 1, type, prompt, imageData, aspectRatio, refImageData)
    );
    await Promise.allSettled(generationPromises);
    generateBtn.disabled = false;
    generateBtn.innerHTML = originalBtnHTML;
    lucide.createIcons();
  }

  async function generateSingleSFImage(id, type, prompt, imageData, aspectRatio, refImageData = null) {
    const card = document.getElementById(`sf-${type}-card-${id}`);
    try {
      const finalPrompt = `${prompt} This is variation number ${id}.`;
      const base64ToBlob = (base64, mimeType) => {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], {type: mimeType});
      };
      const formData = new FormData();
      formData.append('images[]', base64ToBlob(imageData.base64, imageData.mimeType));
      if (refImageData) {
        formData.append('images[]', base64ToBlob(refImageData.base64, refImageData.mimeType));
      }
      formData.append('instruction', finalPrompt);
      formData.append('aspectRatio', aspectRatio);
      const response = await fetch(`${GENERATE_URL}`, {
        method: 'POST',
        headers: {
          'X-API-Key': API_KEY
        },
        body: formData
      });
      if (!response.ok) throw new Error(await getApiErrorMessage(response));
      const result = await response.json();
      if (!result.success || !result.imageUrl) throw new Error("Respon API tidak valid (tidak ada data gambar).");
      const imageUrl = result.imageUrl;
      card.innerHTML = `
                    <img src="${imageUrl}" class="w-full h-full object-cover">
                    <div class="absolute bottom-2 right-2 flex gap-1">
                        <button data-img-src="${imageUrl}" class="view-btn result-action-btn" title="Lihat Gambar">
                            <i data-lucide="eye" class="w-4 h-4"></i>
                        </button>
                        <a href="${imageUrl}" download="${type}_foto_${id}.png" class="result-action-btn download-btn" title="Unduh Gambar">
                            <i data-lucide="download" class="w-4 h-4"></i>
                        </a>
                    </div>`;
      card.className = `relative rounded-2xl overflow-hidden bg-white border border-slate-200 w-full ${getAspectRatioClass(aspectRatio)}`;
      doneSound.play();
    } catch (error) {
      errorSound.play();
      console.error(`Error for SF card ${type}-${id}:`, error);
      card.innerHTML = `<div class="text-xs text-red-500 p-2 text-center break-all">${error.message}</div>`;
    } finally {
      lucide.createIcons();
    }
  }

  // Desain Rumah logic moved to js/desain-rumah.js
  // Sketsa Gambar logic moved to js/sketsa-gambar.js
  // Art & Karikatur logic moved to js/art-karikatur.js
  function updateSliderProgress(slider) {
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const val = parseFloat(slider.value);
    const percentage = ((val - min) * 100) / (max - min);
    slider.style.background = `linear-gradient(to right, var(--accent) ${percentage}%, var(--border-color) ${percentage}%)`;
  }

  let desainRumahModule;
  let sketsaGambarModule;
  let artKarikaturModule;
  let autoRapiModule;
  // Initialize Foto Miniatur Module
  if (window.initFotoMiniatur) {
    fotoMiniatur = window.initFotoMiniatur({
      document,
      setupImageUpload,
      setupOptionButtons,
      updateSliderProgress,
      getAspectRatioClass,
      lucide,
      getApiKey: () => API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
  }
  if (window.initPerbaikiFoto) {
    perbaikiFoto = window.initPerbaikiFoto({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      getApiKey: () => API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
  }
  if (window.initEditFoto) {
    editFoto = window.initEditFoto({
      document,
      setupOptionButtons,
      getApiKey: () => API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      lucide
    });
  }
  if (window.initPerluasFoto) {
    window.initPerluasFoto({
      document,
      setupImageUpload,
      lucide,
      getApiKey: () => API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
  }
  if (window.initKartuNama) {
    window.initKartuNama({
      document,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      getApiKey: () => API_KEY,
      GENERATE_URL,
      CHAT_URL,
      getApiErrorMessage,
      doneSound,
      errorSound,
      switchTab
    });
  }
  if (window.initFaceSwap) {
    window.initFaceSwap({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      getApiKey: () => API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
  }
  if (window.initFotoArtis) {
    window.initFotoArtis({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      getImageAspectRatio,
      lucide,
      getApiKey: () => API_KEY,
      GENERATE_URL,
      CHAT_URL,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
  }
  if (window.initHapusBg) {
    window.initHapusBg({
      document,
      setupImageUpload,
      setupOptionButtons,
      lucide,
      getApiKey: () => API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
  }
  if (window.initGabungFoto) {
    window.gabungFotoModule = window.initGabungFoto({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      getApiKey: () => API_KEY,
      GENERATE_URL,
      CHAT_URL,
      getApiErrorMessage,
      doneSound,
      errorSound,
      convertHeicToJpg
    });
  }
  if (window.initFotoProduk) {
    window.initFotoProduk({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      getApiKey: () => API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound,
      showContentModal,
      hideModal: hideAndClearModal,
      applyLogoToImage,
      getLogoData: () => psLogoData
    });
  }
  if (window.initFotoFashion) {
    window.initFotoFashion({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      getApiKey: () => API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound,
      setupLogoUpload,
      setupLogoControls,
      setupSlider,
      applyLogoToImage
    });
  }
  if (window.initBuatMockup) {
    window.initBuatMockup({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      getApiKey: () => API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
  }
  // Initialize Buat Banner Module
  if (window.initBuatBanner) {
    buatBannerModule = window.initBuatBanner({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      getApiKey: () => API_KEY,
      GENERATE_URL,
      CHAT_URL,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
  }
  // Initialize Potret Cinta Module
  if (window.initPotretCinta) {
    window.initPotretCinta({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
  }
  // Initialize Prewedding Module
  if (window.initPrewedding) {
    window.initPrewedding({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound,
      showContentModal,
      hideAndClearModal
    });
  }
  // Initialize POV Tangan Module
  if (window.initPovTangan) {
    window.initPovTangan({
      document,
      setupImageUpload,
      setupOptionButtons,
      updateSliderProgress,
      getAspectRatioClass,
      lucide,
      API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
  }
  // Initialize Kamar Pas Module
  if (window.initKamarPas) {
    window.initKamarPas({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound,
      getImageAspectRatio
    });
  }
  // Initialize Retouch Wajah Module
  if (window.initRetouchWajah) {
    window.initRetouchWajah({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
  }
  // Initialize Buat Carousel Module
  if (window.initBuatCarousel) {
    window.initBuatCarousel({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      API_KEY,
      CHAT_URL,
      GENERATE_URL,
      getApiErrorMessage,
      showContentModal,
      downloadDataURI,
      JSZip: window.JSZip,
      saveAs: window.saveAs,
      doneSound,
      errorSound
    });
  }

  async function getImageAspectRatio(imageData) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth / img.naturalHeight);
      img.onerror = reject;
      img.src = imageData.dataUrl;
    });
  }

  function getClosestStandardRatio(ratio) {
    const standards = [
      {label: '1:1', value: 1 / 1},
      {label: '16:9', value: 16 / 9},
      {label: '9:16', value: 9 / 16},
      {label: '16:9', value: 4 / 3},
      {label: '9:16', value: 3 / 4}
    ];
    let closest = standards[0];
    let minDiff = Math.abs(ratio - closest.value);
    for (let i = 1; i < standards.length; i++) {
      let diff = Math.abs(ratio - standards[i].value);
      if (diff < minDiff) {
        minDiff = diff;
        closest = standards[i];
      }
    }
    return closest.label;
  }

  function initBeforeAfterSlider(container, beforeSrc, afterSrc) {
    container.innerHTML = `
            <div class="ba-slider-container">
                <img src="${afterSrc}" class="ba-image-img" style="z-index: 1;">
                <div class="ba-resize-div" style="position: absolute; top: 0; left: 0; height: 100%; width: 50%; overflow: hidden; z-index: 2; border-right: 2px solid white;">
                    <img src="${beforeSrc}" class="ba-image-img" style="width: ${container.clientWidth}px; max-width: none;">
                </div>
                <div class="ba-slider-handle" style="left: 50%;">
                    <div class="ba-slider-circle"><i data-lucide="move-horizontal" class="w-4 h-4 text-slate-600"></i></div>
                </div>
                <div class="absolute top-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded z-20">Before</div>
                <div class="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded z-20">After</div>
            </div>
        `;
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    const slider = container.querySelector('.ba-slider-container');
    const resizeDiv = container.querySelector('.ba-resize-div');
    const handle = container.querySelector('.ba-slider-handle');
    const beforeImg = resizeDiv.querySelector('img');
    const updateWidths = () => {
      if (beforeImg && container) {
        beforeImg.style.width = `${container.clientWidth}px`;
      }
    };
    window.addEventListener('resize', updateWidths);
    const move = (e) => {
      const rect = slider.getBoundingClientRect();
      let x = (e.clientX || e.touches[0].clientX) - rect.left;
      x = Math.max(0, Math.min(x, rect.width));
      const percent = (x / rect.width) * 100;
      resizeDiv.style.width = `${percent}%`;
      handle.style.left = `${percent}%`;
    };
    slider.addEventListener('mousemove', move);
    slider.addEventListener('touchmove', move);
  }

  // Initialize Barbershop Module
  if (window.initBarbershop) {
    window.initBarbershop({
      document,
      setupImageUpload,
      setupOptionButtons,
      showContentModal,
      hideAndClearModal,
      lucide,
      API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound,
      getAspectRatioClass,
      getImageAspectRatio,
      getClosestStandardRatio
    });
  }
  // Initialize Desain Rumah Module
  if (window.initDesainRumah) {
    desainRumahModule = window.initDesainRumah({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      API_KEY,
      GENERATE_URL,
      CHAT_URL,
      getApiErrorMessage,
      doneSound,
      errorSound,
      getImageAspectRatio,
      getClosestStandardRatio
    });
  }
  // Initialize Sketsa Gambar Module
  if (window.initSketsaGambar) {
    sketsaGambarModule = window.initSketsaGambar({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
  }
  // Initialize Art & Karikatur Module
  if (window.initArtKarikatur) {
    artKarikaturModule = window.initArtKarikatur({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      API_KEY,
      GENERATE_URL,
      CHAT_URL,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
  }
  lucide.createIcons();
  // Initialize Assistant Module
  if (window.initAssistant) {
    const {initBeranda: initBerandaFn} = window.initAssistant({
      document,
      chatSound,
      switchTab,
      API_KEY,
      GENERATE_URL,
      CHAT_URL,
      lucide,
      convertHeicToJpg,
      base64ToBlob,
      showModernPopup,
      showUploadLimitPopup,
      setupImageUpload,
      getApiErrorMessage,
      doneSound,
      errorSound
    });
    window.initBeranda = initBerandaFn;
    initBerandaFn();
  }
  // Initialize Auto Rapi Module
  if (window.initAutoRapi) {
    autoRapiModule = window.initAutoRapi({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      API_KEY,
      GENERATE_URL,
      CHAT_URL,
      getApiErrorMessage,
      doneSound,
      errorSound,
      initBeforeAfterSlider,
      switchTab
    });
  }
  // Potret Cinta logic moved to js/potret-cinta.js
  const footerTimeout = setTimeout(() => {
    const footerEl = document.getElementById('footer-text');
    if (footerEl && !footerEl.innerHTML.includes('Ichsan Labs') && false) {
      footerEl.innerHTML = `
                <div class="flex flex-col items-center gap-2 animate-in fade-in zoom-in duration-300">
                    <span class="text-xs text-red-400 font-medium">Koneksi lambat?</span>
                    <button onclick="window.location.reload()" class="flex items-center gap-1.5 text-xs bg-white border border-slate-200 text-slate-600 px-4 py-1.5 rounded-full shadow-sm hover:bg-slate-50 hover:text-teal-600 transition-all">
                        <i data-lucide="refresh-cw" class="w-3 h-3"></i> Refresh Halaman
                    </button>
                </div>
            `;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  }, 30000);
  switchTab('beranda');
  const initialLoader = document.getElementById('initial-page-loader');
  if (initialLoader) {
    initialLoader.classList.add('opacity-0');
    setTimeout(() => initialLoader.remove(), 700);
  }
  const footerTextEl = document.getElementById('footer-text');
  if (footerTextEl) {
    const appVariant = document.body?.dataset?.app;
    const logoImg = '<img src="https://cdn.jsdelivr.net/gh/syifarahmat/sulap.foto@a5c9c446bcda2d5a664cd1c6a222f270acbd8678/assets/sflogo.png" class="w-3 h-3 inline-block mr-1 align-middle" alt="Logo">';
    if (appVariant === 'vip') {
      footerTextEl.innerHTML = `${logoImg} 2026. Sulap Foto 5.0 <span class="inline-flex items-center gap-1 bg-gradient-to-tr from-amber-400 to-yellow-200 text-amber-950 text-[10px] font-black px-2 py-0.5 rounded-full shadow-[0_0_10px_rgba(251,191,36,0.35)] tracking-wider border border-yellow-400/30 align-middle">VIP</span> By It's Me`;
    } else {
      footerTextEl.innerHTML = `${logoImg} 2026. Sulap Foto 5.0 Pro By It's Me`;
    }
  }
  const rmpPlayer = document.getElementById('ramadhan-music-player');
  if (rmpPlayer) {
    const rmpAudio = document.getElementById('ramadhan-audio');
    const rmpPlayBtn = document.getElementById('rmp-play');
    const rmpNextBtn = document.getElementById('rmp-next');
    const rmpTitle = document.getElementById('rmp-track-title');
    const rmpEq = document.getElementById('rmp-eq');
    const rmpVolume = document.getElementById('rmp-volume');
    const rmpToggle = document.getElementById('rmp-toggle');
    const tracks = [
      {title: 'Penuh Berkah', src: 'https://cdn.jsdelivr.net/gh/syifarahmat/sulap.foto@a5c9c446bcda2d5a664cd1c6a222f270acbd8678/assets/Penuh Berkah.mp3'},
      {title: 'Ramadhan Cuan', src: 'https://cdn.jsdelivr.net/gh/syifarahmat/sulap.foto@a5c9c446bcda2d5a664cd1c6a222f270acbd8678/assets/Ramadhan Cuan.mp3'}
    ];
    let currentIndex = 0;
    let hasAutoPlayed = false;
    const setPlayIcon = (iconName) => {
      if (!rmpPlayBtn) return;
      rmpPlayBtn.innerHTML = `<i data-lucide="${iconName}" class="rmp-icon"></i>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    };
    const setToggleIcon = (iconName, label) => {
      if (!rmpToggle) return;
      rmpToggle.setAttribute('aria-label', label);
      rmpToggle.innerHTML = `<i data-lucide="${iconName}" class="rmp-icon"></i>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    };
    const setTrack = (index, shouldPlay = false) => {
      if (!rmpAudio) return;
      currentIndex = index % tracks.length;
      if (rmpTitle) rmpTitle.textContent = tracks[currentIndex].title;
      rmpAudio.src = tracks[currentIndex].src;
      rmpAudio.load();
      if (shouldPlay) {
        rmpAudio.play().catch(() => {
        });
      }
    };
    if (rmpAudio && rmpVolume) {
      rmpAudio.volume = parseFloat(rmpVolume.value || '0.6');
      rmpVolume.addEventListener('input', (e) => {
        rmpAudio.volume = parseFloat(e.target.value);
      });
    }
    if (rmpAudio) {
      rmpAudio.addEventListener('play', () => {
        if (rmpEq) rmpEq.classList.add('playing');
        setPlayIcon('pause');
      });
      rmpAudio.addEventListener('pause', () => {
        if (rmpEq) rmpEq.classList.remove('playing');
        setPlayIcon('play');
      });
      // Draggable Logic for Music Player
      if (typeof rmpPlayer !== 'undefined' && rmpPlayer) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const initDragPosition = () => {
          if (rmpPlayer.dataset.dragInitialized) return;
          const rect = rmpPlayer.getBoundingClientRect();
          rmpPlayer.style.left = rect.left + 'px';
          rmpPlayer.style.top = rect.top + 'px';
          rmpPlayer.style.bottom = 'auto';
          rmpPlayer.style.right = 'auto';
          rmpPlayer.style.transform = 'none';
          rmpPlayer.style.margin = '0';
          rmpPlayer.dataset.dragInitialized = 'true';
        };
        const dragMouseDown = (e) => {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.closest('input')) return;
          e.preventDefault();
          initDragPosition();
          pos3 = e.clientX;
          pos4 = e.clientY;
          document.onmouseup = closeDragElement;
          document.onmousemove = elementDrag;
        };
        const dragTouchStart = (e) => {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.closest('input')) return;
          // e.preventDefault();
          initDragPosition();
          pos3 = e.touches[0].clientX;
          pos4 = e.touches[0].clientY;
          document.ontouchend = closeDragElement;
          document.ontouchmove = elementDragTouch;
        };
        const elementDrag = (e) => {
          e.preventDefault();
          pos1 = pos3 - e.clientX;
          pos2 = pos4 - e.clientY;
          pos3 = e.clientX;
          pos4 = e.clientY;
          rmpPlayer.style.top = (rmpPlayer.offsetTop - pos2) + "px";
          rmpPlayer.style.left = (rmpPlayer.offsetLeft - pos1) + "px";
        };
        const elementDragTouch = (e) => {
          // e.preventDefault();
          pos1 = pos3 - e.touches[0].clientX;
          pos2 = pos4 - e.touches[0].clientY;
          pos3 = e.touches[0].clientX;
          pos4 = e.touches[0].clientY;
          rmpPlayer.style.top = (rmpPlayer.offsetTop - pos2) + "px";
          rmpPlayer.style.left = (rmpPlayer.offsetLeft - pos1) + "px";
        };
        const closeDragElement = () => {
          document.onmouseup = null;
          document.onmousemove = null;
          document.ontouchend = null;
          document.ontouchmove = null;
        };
        // rmpPlayer.onmousedown = dragMouseDown;
        // rmpPlayer.ontouchstart = dragTouchStart;
      }
      rmpAudio.addEventListener('ended', () => {
        setTrack((currentIndex + 1) % tracks.length, true);
      });
    }
    const attemptAutoplay = () => {
      if (hasAutoPlayed || !rmpAudio) return;
      hasAutoPlayed = true;
      if (rmpAudio.paused) {
        rmpAudio.play().catch(() => {
          hasAutoPlayed = false;
        });
      }
    };
    if (rmpPlayBtn) {
      rmpPlayBtn.addEventListener('click', () => {
        if (!rmpAudio) return;
        if (rmpAudio.paused) {
          rmpAudio.play().catch(() => {
          });
        } else {
          rmpAudio.pause();
        }
      });
    }
    if (rmpNextBtn) {
      rmpNextBtn.addEventListener('click', () => {
        setTrack((currentIndex + 1) % tracks.length, true);
      });
    }
    // rmpToggle logic removed as per request
    // Auto-hide (minimize) on mobile start - REMOVED
    window.addEventListener('scroll', attemptAutoplay, {once: true, passive: true});
    window.addEventListener('touchstart', attemptAutoplay, {once: true, passive: true});
    window.addEventListener('pointerdown', attemptAutoplay, {once: true, passive: true});
    setTrack(0, false);
    setPlayIcon('play');
  }
  if (typeof initBuatGambar === 'function') {
    initBuatGambar({
      setupOptionButtons,
      setupLogoUpload,
      setupLogoControls,
      setupSlider,
      API_KEY,
      GENERATE_URL,
      getApiErrorMessage
    });
  }
  // Initialize Foto Wisuda Module
  if (window.initFotoWisuda) {
    window.initFotoWisuda({
      document,
      setupImageUpload,
      setupOptionButtons,
      getAspectRatioClass,
      lucide,
      API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound,
      convertHeicToJpg,
      switchTab
    });
  }
  const tabCreateMascot = document.getElementById('tab-create-mascot');
  if (tabCreateMascot) {
    tabCreateMascot.addEventListener('click', () => switchTab('create-mascot'));
    if (typeof initBuatMascot === 'function') {
      initBuatMascot({
        document,
        setupOptionButtons,
        getAspectRatioClass,
        lucide,
        getApiKey: () => API_KEY,
        GENERATE_URL,
        getApiErrorMessage,
        doneSound,
        errorSound
      });
    }
  }
  // Initialize Video Thumbnail Module
  if (window.initVideoThumbnail) {
    window.initVideoThumbnail({
      document,
      convertHeicToJpg,
      lucide,
      API_KEY,
      GENERATE_URL,
      CHAT_URL,
      getApiErrorMessage,
      doneSound,
      errorSound,
      getAspectRatioClass,
      switchTab
    });
  }
  // Initialize Watermark Module
  if (window.initWatermark) {
    window.initWatermark({
      document,
      API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound,
      switchTab,
      convertHeicToJpg,
      lucide
    });
  }
  // Foto Polaroid logic moved to js/foto-polaroid.js
  const tabSizeProduk = document.getElementById('tab-size-produk');
  if (tabSizeProduk) {
    tabSizeProduk.addEventListener('click', () => switchTab('size-produk'));
    const spProductName = document.getElementById('sp-product-name');
    const spProductSize = document.getElementById('sp-product-size');
    const spCompareOptions = document.getElementById('sp-compare-options');
    const spRatioOptions = document.getElementById('sp-ratio-options');
    const spCountSlider = document.getElementById('sp-count-slider');
    const spCountValue = document.getElementById('sp-count-value');
    const spGenerateBtn = document.getElementById('sp-generate-btn');
    const spResultsGrid = document.getElementById('sp-results-grid');
    const spResultsPlaceholder = document.getElementById('sp-results-placeholder');
    const spSourceUpload = document.getElementById('sp-source-upload');
    const spSourceManual = document.getElementById('sp-source-manual');
    const spUploadSection = document.getElementById('sp-upload-section');
    const spManualSection = document.getElementById('sp-manual-section');
    const spAnalysisResult = document.getElementById('sp-analysis-result');
    const spResultSizeInput = document.getElementById('sp-result-size-input');
    const spImageInput = document.getElementById('sp-image-input');
    const spUploadBox = document.getElementById('sp-upload-box');
    const spUploadPlaceholder = document.getElementById('sp-upload-placeholder');
    const spUploadPreview = document.getElementById('sp-upload-preview');
    const spRemoveUpload = document.getElementById('sp-remove-upload');
    const spAnalyzeBtn = document.getElementById('sp-analyze-btn');
    const spAnalyzeTextBtn = document.getElementById('sp-analyze-text-btn');
    let spImageData = null;
    let spActiveSource = 'upload';
    let spAnalyzedData = {size: ''};

    function spSetSource(source) {
      spActiveSource = source;
      if (source === 'upload') {
        spSourceUpload.classList.add('bg-white', 'text-teal-600', 'shadow-sm');
        spSourceUpload.classList.remove('text-slate-500');
        spSourceManual.classList.remove('bg-white', 'text-teal-600', 'shadow-sm');
        spSourceManual.classList.add('text-slate-500');
        spUploadSection.classList.remove('hidden');
        spManualSection.classList.add('hidden');
        spAnalysisResult.classList.remove('hidden');
      } else {
        spSourceManual.classList.add('bg-white', 'text-teal-600', 'shadow-sm');
        spSourceManual.classList.remove('text-slate-500');
        spSourceUpload.classList.remove('bg-white', 'text-teal-600', 'shadow-sm');
        spSourceUpload.classList.add('text-slate-500');
        spUploadSection.classList.add('hidden');
        spManualSection.classList.remove('hidden');
        spAnalysisResult.classList.add('hidden');
      }
    }

    if (spSourceUpload && spSourceManual) {
      spSourceUpload.addEventListener('click', () => spSetSource('upload'));
      spSourceManual.addEventListener('click', () => spSetSource('manual'));
      spSetSource('upload');
    }
    setupImageUpload(spImageInput, spUploadBox, (data) => {
      spImageData = data;
      spUploadPreview.src = data.dataUrl;
      spUploadPreview.classList.remove('hidden');
      spUploadPlaceholder.classList.add('hidden');
      spRemoveUpload.classList.remove('hidden');
      spAnalyzeBtn.disabled = false;
      spAnalyzedData = {size: ''};
      spResultSizeInput.value = '';
      spAnalysisResult.classList.remove('hidden');
    });
    if (spRemoveUpload) {
      spRemoveUpload.addEventListener('click', (e) => {
        e.stopPropagation();
        spImageData = null;
        spImageInput.value = '';
        spUploadPreview.src = '';
        spUploadPreview.classList.add('hidden');
        spUploadPlaceholder.classList.remove('hidden');
        spRemoveUpload.classList.add('hidden');
        spAnalyzeBtn.disabled = true;
        spAnalyzedData = {size: ''};
        spResultSizeInput.value = '';
        spAnalysisResult.classList.remove('hidden');
      });
    }

    function handleAnalysisResult(data) {
      spAnalyzedData.size = data.size || '';
      if (spActiveSource === 'upload') {
        spResultSizeInput.value = spAnalyzedData.size;
        spAnalysisResult.classList.remove('hidden');
      } else {
        spProductName.value = data.name || spProductName.value;
        spProductSize.value = spAnalyzedData.size;
        spProductName.classList.add('ring-2', 'ring-teal-500');
        spProductSize.classList.add('ring-2', 'ring-teal-500');
        setTimeout(() => {
          spProductName.classList.remove('ring-2', 'ring-teal-500');
          spProductSize.classList.remove('ring-2', 'ring-teal-500');
        }, 2000);
      }
      if (data.comparisons && Array.isArray(data.comparisons) && data.comparisons.length > 0) {
        spCompareOptions.innerHTML = '';
        data.comparisons.forEach((comp, index) => {
          const btn = document.createElement('button');
          btn.dataset.value = comp;
          btn.className = `option-btn ${index === 0 ? 'selected' : ''} py-2.5`;
          btn.textContent = comp;
          spCompareOptions.appendChild(btn);
        });
      }
    }

    if (spAnalyzeBtn) {
      spAnalyzeBtn.addEventListener('click', async () => {
        if (!spImageData) return;
        const originalBtnHTML = spAnalyzeBtn.innerHTML;
        spAnalyzeBtn.disabled = true;
        spAnalyzeBtn.innerHTML = `<div class="loader-icon w-4 h-4 rounded-full"></div> Menganalisa...`;
        try {
          const prompt = `Analyze this image and identify the main object. Estimate its real-world dimensions (length, width, or height) in metric (cm) or imperial (inch).
                            Also suggest 6 suitable comparison objects to visualize scale.
                            CRITICAL: The comparison objects MUST be in Bahasa Indonesia (e.g., Koin, Tangan, Manusia, Mobil).
                            Return JSON: {"size": "Dimensions", "comparisons": ["Benda1", "Benda2", ...]}. Only JSON. No Object Name needed.`;
          const formData = new FormData();
          formData.append('prompt', prompt);
          const base64ToBlob = (base64, mimeType) => {
            const byteCharacters = atob(base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            return new Blob([byteArray], {type: mimeType});
          };
          formData.append('images[]', base64ToBlob(spImageData.base64, spImageData.mimeType), 'object.jpg');
          const response = await fetch(`${CHAT_URL}`, {
            method: 'POST',
            headers: {
              'X-API-Key': API_KEY
            },
            body: formData
          });
          if (!response.ok) throw new Error(await getApiErrorMessage(response));
          const result = await response.json();
          const text = (result.success && result.response ? result.response : (result.response || result.candidates?.[0]?.content?.parts?.[0]?.text || '')).trim();
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            handleAnalysisResult(JSON.parse(jsonMatch[0]));
          } else {
            alert("Gagal membaca hasil analisa.");
          }
        } catch (error) {
          console.error("Image Analysis failed:", error);
          alert("Gagal menganalisa gambar: " + error.message);
        } finally {
          spAnalyzeBtn.innerHTML = originalBtnHTML;
          spAnalyzeBtn.disabled = false;
        }
      });
    }
    if (spAnalyzeTextBtn) {
      spAnalyzeTextBtn.addEventListener('click', async () => {
        const nameInput = spProductName.value.trim();
        if (!nameInput) {
          alert("Masukkan nama objek terlebih dahulu.");
          return;
        }
        const originalBtnHTML = spAnalyzeTextBtn.innerHTML;
        const originalBg = spAnalyzeTextBtn.style.background;
        spAnalyzeTextBtn.disabled = true;
        spAnalyzeTextBtn.innerHTML = `<div class="loader-icon w-3 h-3 border-teal-600"></div>`;
        try {
          const prompt = `Object Name: "${nameInput}".
                            Estimate its standard real-world dimensions. Suggest 6 suitable comparison objects.
                            CRITICAL: The comparison objects MUST be in Bahasa Indonesia.
                            Return JSON: {"name": "${nameInput}", "size": "Estimated Dimensions", "comparisons": ["Benda1", "Benda2", ...]}. Only JSON.`;
          const formData = new FormData();
          formData.append('prompt', prompt);
          const response = await fetch(`${CHAT_URL}`, {
            method: 'POST',
            headers: {
              'X-API-Key': API_KEY
            },
            body: formData
          });
          if (!response.ok) throw new Error(await getApiErrorMessage(response));
          const result = await response.json();
          const text = (result.success && result.response ? result.response : (result.response || result.candidates?.[0]?.content?.parts?.[0]?.text || '')).trim();
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            handleAnalysisResult(JSON.parse(jsonMatch[0]));
          } else {
            alert("Gagal mendapatkan data objek.");
          }
        } catch (error) {
          console.error("Text Analysis failed:", error);
          alert("Gagal menganalisa teks: " + error.message);
        } finally {
          spAnalyzeTextBtn.innerHTML = originalBtnHTML;
          spAnalyzeTextBtn.disabled = false;
        }
      });
    }
    if (spCountSlider && spCountValue) {
      spCountSlider.addEventListener('input', (e) => {
        spCountValue.textContent = e.target.value;
      });
    }
    [spCompareOptions, spRatioOptions].forEach(parent => {
      if (parent) {
        parent.addEventListener('click', (e) => {
          const btn = e.target.closest('button');
          if (btn) {
            parent.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
            btn.classList.add('selected');
          }
        });
      }
    });
  }
  // Initialize Age Filter Module
  if (window.initAgeFilter) {
    window.initAgeFilter({
      document,
      API_KEY,
      GENERATE_URL,
      getApiErrorMessage,
      doneSound,
      errorSound,
      switchTab,
      convertHeicToJpg,
      setupOptionButtons,
      lucide
    });
  }
  // Initialize POV Selfie Module
  if (window.initPOVSelfie) {
    window.initPOVSelfie({
      document,
      API_KEY,
      GENERATE_URL,
      setupImageUpload,
      setupOptionButtons,
      lucide,
      doneSound,
      errorSound,
      switchTab
    });
  }
});
document.addEventListener('DOMContentLoaded', () => {
  const sulapVideoBtn = document.getElementById('tab-sulap-video');
  const sulapVideoModal = document.getElementById('sulap-video-modal');
  const closeSulapVideoModal = document.getElementById('close-sulap-video-modal');
  if (sulapVideoBtn && sulapVideoModal && closeSulapVideoModal) {
    sulapVideoBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const sidebar = document.querySelector('aside');
      const backdrop = document.getElementById('sidebar-backdrop');
      if (sidebar && !sidebar.classList.contains('-translate-x-full') && window.innerWidth < 768) {
        sidebar.classList.add('-translate-x-full');
        if (backdrop) backdrop.classList.remove('opacity-100', 'pointer-events-auto');
      }
      sulapVideoModal.classList.add('visible');
      if (typeof lucide !== 'undefined') lucide.createIcons();
    });
    closeSulapVideoModal.addEventListener('click', () => {
      sulapVideoModal.classList.remove('visible');
    });
    sulapVideoModal.addEventListener('click', (e) => {
      if (e.target === sulapVideoModal) {
        sulapVideoModal.classList.remove('visible');
      }
    });
  }
});
document.addEventListener('DOMContentLoaded', () => {
  if (typeof window !== 'undefined' && window.IS_VIP_APP) return;
  const modal = document.getElementById('upgrade-vip-modal');
  const closeBtn = document.getElementById('upgrade-vip-modal-close');
  if (!modal) return;
  const closeModal = () => modal.classList.remove('active');
  const showUpgradeVipModal = () => {
    modal.classList.add('active');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };
  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  const handleVipClick = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    showUpgradeVipModal();
  };
  // Function to attach listener to VIP buttons
  const vipGenerateButtonIds = [
    'ti-generate-btn',
    'bc-generate-btn',
    'cl-generate-btn',
    'bm-generate-btn',
    'fk-generate-btn',
    'fp-generate-btn',
    'cf-generate-btn',
    'sp-generate-btn',
    'ho-generate-btn',
    'gp-generate-btn',
    'vt-generate-btn',
    'wm-generate-btn',
    'af-generate-btn',
    'povs-generate-btn',
    'w2-generate-btn'
  ];
  const attachVipGenerateListeners = () => {
    vipGenerateButtonIds.forEach((id) => {
      const btn = document.getElementById(id);
      if (btn && !btn.dataset.vipGenerateAttached) {
        btn.addEventListener('click', handleVipClick, true);
        btn.dataset.vipGenerateAttached = 'true';
      }
    });
  };
  const attachVipCountLimit = () => {
    const sliders = document.querySelectorAll('input[type="range"][id$="-count-slider"]');
    sliders.forEach((slider) => {
      if (slider.dataset.vipCountAttached) return;
      slider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value, 10) || 0;
        if (value > 4) {
          e.target.value = 4;
          const valueEl = document.getElementById(e.target.id.replace('-slider', '-value'));
          if (valueEl) valueEl.textContent = '4';
          showUpgradeVipModal();
        }
      });
      slider.dataset.vipCountAttached = 'true';
    });
  };
  // Initial attach
  attachVipGenerateListeners();
  attachVipCountLimit();
  // Observer for dynamic content
  const observer = new MutationObserver((mutations) => {
    let shouldReattach = false;
    mutations.forEach((mutation) => {
      if (mutation.addedNodes.length > 0) shouldReattach = true;
    });
    if (shouldReattach) {
      attachVipGenerateListeners();
      attachVipCountLimit();
    }
  });
  observer.observe(document.body, {childList: true, subtree: true});
});
document.addEventListener('DOMContentLoaded', () => {
  const banner = document.getElementById('pwa-install-modal');
  if (!banner) return;
  if (window.IS_VIP_APP) {
    localStorage.setItem('sf_pwa_start_path', '/vipacc');
  }
  const startPath = localStorage.getItem('sf_pwa_start_path') || '';
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (isStandalone && startPath === '/vipacc' && window.location.pathname !== '/vipacc') {
    window.location.replace('/vipacc');
    return;
  }
  if (banner.parentElement !== document.body) {
    document.body.appendChild(banner);
  }
  const installBtn = document.getElementById('pwa-install-btn');
  const dismissBtn = document.getElementById('pwa-dismiss-btn');
  const neverBtn = document.getElementById('pwa-never-btn');
  const closeBtn = document.getElementById('pwa-close-btn');
  const backdrop = document.getElementById('pwa-install-backdrop');
  const sectionPrompt = document.getElementById('pwa-section-prompt');
  const sectionIos = document.getElementById('pwa-section-ios');
  const sectionAndroid = document.getElementById('pwa-section-android');
  const sectionDesktop = document.getElementById('pwa-section-desktop');
  const dismissed = localStorage.getItem('sf_pwa_prompt_dismissed') === '1';
  const isVerified = localStorage.getItem('sulapfoto_verified_email');
  if (dismissed || isStandalone || !isVerified) {
    banner.classList.add('hidden');
    return;
  }
  const ua = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);
  const isMac = /macintosh/.test(ua) && !isIOS;
  const isWindows = /windows/.test(ua);
  let deferredPrompt = null;
  const hideAllSections = () => {
    [sectionPrompt, sectionIos, sectionAndroid, sectionDesktop].forEach((section) => {
      if (section && !section.classList.contains('hidden')) section.classList.add('hidden');
    });
  };
  const setSections = (mode) => {
    hideAllSections();
    if (mode === 'prompt' && sectionPrompt) sectionPrompt.classList.remove('hidden');
    if (mode === 'ios' && sectionIos) sectionIos.classList.remove('hidden');
    if (mode === 'android' && sectionAndroid) sectionAndroid.classList.remove('hidden');
    if (mode === 'desktop' && sectionDesktop) sectionDesktop.classList.remove('hidden');
    if (installBtn) {
      if (mode === 'prompt') installBtn.classList.remove('hidden');
      else installBtn.classList.add('hidden');
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };
  const showBanner = () => {
    banner.classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };
  const hideBanner = () => {
    banner.classList.add('hidden');
  };
  if (dismissBtn) dismissBtn.addEventListener('click', hideBanner);
  if (closeBtn) closeBtn.addEventListener('click', hideBanner);
  if (backdrop) backdrop.addEventListener('click', hideBanner);
  if (neverBtn) {
    neverBtn.addEventListener('click', () => {
      localStorage.setItem('sf_pwa_prompt_dismissed', '1');
      hideBanner();
    });
  }
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        localStorage.setItem('sf_pwa_prompt_dismissed', '1');
      }
      deferredPrompt = null;
      hideBanner();
    });
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const dismissed = localStorage.getItem('sf_pwa_prompt_dismissed') === '1';
    const isVerified = localStorage.getItem('sulapfoto_verified_email');
    if (dismissed || isStandalone || !isVerified) return;
    showBanner();
    setSections('prompt');
  });
  window.addEventListener('appinstalled', () => {
    localStorage.setItem('sf_pwa_prompt_dismissed', '1');
    hideBanner();
  });
  const fallbackShow = () => {
    if (dismissed || isStandalone) return;
    if (deferredPrompt) {
      setSections('prompt');
      showBanner();
      return;
    }
    if (isIOS) setSections('ios');
    else if (isAndroid) setSections('android');
    else if (isMac || isWindows) setSections('desktop');
    else setSections('desktop');
    showBanner();
  };
  setTimeout(fallbackShow, 400);
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('https://cdn.jsdelivr.net/gh/syifarahmat/sulap.foto@a5c9c446bcda2d5a664cd1c6a222f270acbd8678/assets/sw.js').catch(() => {
      });
    });
  }
});
// Integration of /chat features
document.addEventListener('DOMContentLoaded', () => {
  // --- AI Concept Magic Button ---
  const akMagicPromptBtn = document.getElementById('ak-magic-prompt-btn');
  const akPromptInput = document.getElementById('ak-prompt-input');
  const akTypeOptions = document.getElementById('ak-type-options');
  const akStyleOptions = document.getElementById('ak-style-options');
  const akCustomStyleInput = document.getElementById('ak-custom-style-input');
  if (akMagicPromptBtn && akPromptInput) {
    akMagicPromptBtn.addEventListener('click', async () => {
      // Check akImageData
      let hasImage = false;
      if (typeof akImageData !== 'undefined' && akImageData) {
        hasImage = true;
      }
      if (!hasImage) {
        alert("Upload gambar dulu ya!");
        return;
      }
      const originalBtnHTML = akMagicPromptBtn.innerHTML;
      akMagicPromptBtn.disabled = true;
      akMagicPromptBtn.innerHTML = `<div class="loader-icon w-4 h-4 rounded-full border-2 border-teal-500 border-t-transparent animate-spin"></div>`;
      try {
        const type = akTypeOptions.querySelector('.selected').dataset.value;
        let style = akStyleOptions.querySelector('.selected').dataset.value;
        if (style === 'Kustom') {
          style = akCustomStyleInput.value.trim() || 'Seni Digital';
        }
        const systemPrompt = `You are a creative art director. Analyze the user's photo, their chosen art type, and style. Based on these, write a concise, descriptive instruction in Indonesian that adds creative details to the final image. For example, 'Tambahkan latar belakang pemandangan kota di malam hari dengan lampu neon' or 'Buat ekspresi wajah menjadi tersenyum lebar dan gembira'. Respond ONLY with the instruction text.`;
        const userQuery = `Analisis foto ini. Jenis: ${type}. Gaya: ${style}. Buatkan satu instruksi tambahan yang kreatif.`;
        const formData = new FormData();
        formData.append('prompt', userQuery);
        formData.append('instruction', systemPrompt);
        const byteCharacters = atob(akImageData.base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], {type: akImageData.mimeType});
        formData.append('images[]', blob, `image.jpg`);
        const response = await fetch(`${CHAT_URL}`, {
          method: 'POST',
          headers: {
            'X-API-Key': API_KEY
          },
          body: formData
        });
        if (!response.ok) throw new Error("Gagal menghubungi AI");
        const result = await response.json();
        if (result.success && result.response) {
          akPromptInput.value = result.response.trim();
        }
      } catch (error) {
        console.error("AI Concept Magic Error:", error);
        alert(error.message);
      } finally {
        akMagicPromptBtn.innerHTML = originalBtnHTML;
        akMagicPromptBtn.disabled = false;
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    });
  }
});
// Logo Upload Logic
let psLogoData = null;
let fsLogoData = null;
let tiLogoData = null;

function setupLogoUpload(inputId, previewId, removeBtnId, controlsId, callback) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  const removeBtn = document.getElementById(removeBtnId);
  const controls = document.getElementById(controlsId);
  if (!input) return;
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target.result.split(',')[1];
        const mimeType = file.type;
        const dataUrl = e.target.result;
        preview.src = dataUrl;
        preview.classList.remove('hidden');
        removeBtn.classList.remove('hidden');
        if (controls) controls.classList.remove('hidden');
        callback({base64, mimeType, dataUrl});
      };
      reader.readAsDataURL(file);
    }
  });
  removeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    input.value = '';
    preview.src = '';
    preview.classList.add('hidden');
    removeBtn.classList.add('hidden');
    if (controls) controls.classList.add('hidden');
    callback(null);
  });
}

function setupLogoControls(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) {
      // Remove selected class from siblings
      btn.parentElement.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    }
  });
}

function setupSlider(inputId, valueId, suffix = '') {
  const input = document.getElementById(inputId);
  const valueDisplay = document.getElementById(valueId);
  if (input && valueDisplay) {
    input.addEventListener('input', () => {
      valueDisplay.textContent = input.value + suffix;
    });
  }
}

// Initialize Logo Uploaders
setupLogoUpload('ps-logo-input', 'ps-logo-preview', 'ps-logo-remove', 'ps-logo-controls', (data) => {
  psLogoData = data;
});
setupLogoUpload('fs-logo-input', 'fs-logo-preview', 'fs-logo-remove', 'fs-logo-controls', (data) => {
  fsLogoData = data;
});
setupLogoUpload('ti-logo-input', 'ti-logo-preview', 'ti-logo-remove', 'ti-logo-controls', (data) => {
  tiLogoData = data;
});
// Initialize Controls
setupLogoControls('ps-logo-position-options');
setupLogoControls('fs-logo-position-options');
setupLogoControls('ti-logo-position-options');
setupSlider('ps-logo-opacity-input', 'ps-logo-opacity-value', '%');
setupSlider('ps-logo-size-input', 'ps-logo-size-value', 'px');
setupSlider('fs-logo-opacity-input', 'fs-logo-opacity-value', '%');
// setupSlider('fs-logo-size-input', 'fs-logo-size-value', 'px');
// Helper to Apply Logo
async function applyLogoToImage(imageSrc, logoBase64, position, opacity, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      // Draw main image
      ctx.drawImage(img, 0, 0);
      if (logoBase64) {
        const logo = new Image();
        logo.crossOrigin = "Anonymous"; // Ensure logo also handles CORS if needed
        logo.onload = () => {
          // Logo sizing
          const logoWidth = size || 2;
          const scale = logoWidth / logo.width;
          const logoHeight = logo.height * scale;
          let x = 0;
          let y = 0;
          const padding = canvas.width * 0.05;
          switch (position) {
            case 'top-left':
              x = padding;
              y = padding;
              break;
            case 'top-right':
              x = canvas.width - logoWidth - padding;
              y = padding;
              break;
            case 'bottom-left':
              x = padding;
              y = canvas.height - logoHeight - padding;
              break;
            case 'bottom-right':
              x = canvas.width - logoWidth - padding;
              y = canvas.height - logoHeight - padding;
              break;
            case 'center':
              x = (canvas.width - logoWidth) / 2;
              y = (canvas.height - logoHeight) / 2;
              break;
            default: // bottom-right default
              x = canvas.width - logoWidth - padding;
              y = canvas.height - logoHeight - padding;
          }
          ctx.globalAlpha = opacity;
          ctx.drawImage(logo, x, y, logoWidth, logoHeight);
          ctx.globalAlpha = 1.0;
          resolve(canvas.toDataURL('image/png'));
        };
        logo.onerror = (e) => {
          console.error("Failed to load logo image", e);
          resolve(imageSrc); // Fallback to original
        };
        logo.src = 'data:image/png;base64,' + logoBase64;
      } else {
        resolve(imageSrc);
      }
    };
    img.onerror = (e) => {
      console.error("Failed to load main image for logo application", e);
      // If we can't load the image (CORS?), we return the original src
      resolve(imageSrc);
    };
    img.src = imageSrc;
  });
}

if (!window.location.href.includes('blob:https')) {
// Auto Refresh Logic
  (function () {
    // Auto-refresh logic handled by checkAppConfig polling now
    // Firebase listener removed
    // Fetch System Info separately on load
    fetch('server/proxy.php/systeminfo')
    .then(res => res.json())
    .then(data => {
      if (data.success && data.system_info) {
        // We don't have a direct global variable for system_info in script.js
        // but we can dispatch an event or handle it if needed.
        // For now, let's just log it or update UI if there are elements for it.
        // The original code used config.system_info to update specific UI elements
        // but those elements seem to be handled by other scripts or not present in this snippet.
        // If there is a global handler for system info, call it here.
        // Example: Update connection status indicators if they exist
        if (typeof updateSystemStatusUI === 'function') {
          updateSystemStatusUI(data.system_info);
        }
        // Store in global variable if needed for other modules
        window.SYSTEM_INFO = data.system_info;
        // Trigger event
        const event = new CustomEvent('systemInfoUpdated', {detail: data.system_info});
        document.dispatchEvent(event);
      }
    })
    .catch(err => console.error("Failed to fetch system info:", err));
  })();
// Boost Generate Toggle Logic
  document.addEventListener('DOMContentLoaded', () => {
    let userBoostQuota = 100;
    const boostToggle = document.getElementById('boost-generate-toggle');

    function updateBoostLabel() {
      if (!boostToggle) return;
      const container = boostToggle.closest('.flex.items-center.justify-between');
      if (!container) return;
      const p = container.querySelector('p.text-\\[9px\\]');
      if (p) {
        if (boostToggle.checked) {
          p.textContent = `Sisa kuota boost ${userBoostQuota} gambar`;
          p.classList.remove('text-slate-400');
          p.classList.add('text-emerald-500', 'font-bold');
        } else if (userBoostQuota === 0) {
          p.textContent = `Sisa kuota boost ${userBoostQuota} gambar`;
          p.classList.remove('text-emerald-500');
          p.classList.add('text-slate-400', 'font-bold');
        } else {
          p.textContent = 'Aktifkan untuk kecepatan generate maksimal!';
          p.classList.remove('text-emerald-500', 'font-bold');
          p.classList.add('text-slate-400');
        }
      }
    }

    async function fetchBoostQuota() {
      const email = localStorage.getItem('sulapfoto_verified_email');
      if (!email) return;
      try {
        const res = await fetch('server/boost_quota.php?action=get_status&email=' + encodeURIComponent(email) + '&_ts=' + Date.now());
        const data = await res.json();
        if (data.success) {
          userBoostQuota = parseInt(data.quota);
          // Sync boost status with server
          const serverBoostActive = data.boost_active === true;
          if (boostToggle && !boostToggle.disabled) {
            if (serverBoostActive && userBoostQuota > 0) {
              boostToggle.checked = true;
              if (typeof PARAREL_GENERATE !== 'undefined') PARAREL_GENERATE = "TRUE";
            } else {
              boostToggle.checked = false;
              if (typeof PARAREL_GENERATE !== 'undefined') PARAREL_GENERATE = "FALSE";
            }
            // Update server dropdown visibility
            const boostServerContainer = document.getElementById('boost-server-container');
            if (boostServerContainer && typeof BASE_URLS !== 'undefined' && BASE_URLS.length > 1) {
              if (boostToggle.checked) {
                boostServerContainer.classList.remove('hidden');
              } else {
                boostServerContainer.classList.add('hidden');
              }
            }
          }
          updateBoostLabel();
        }
      } catch (e) {
        console.error('Failed to fetch boost quota', e);
      }
    }

    // Expose globally
    window.fetchBoostQuota = fetchBoostQuota;
    // Initial fetch
    fetchBoostQuota();
    if (boostToggle) {
      // Initialize state based on variable (will be overridden by fetchBoostQuota)
      // boostToggle.checked = (typeof PARAREL_GENERATE !== 'undefined' && PARAREL_GENERATE === "TRUE");
      updateBoostLabel();
      // Handle change for variable update (only fires if not prevented)
      boostToggle.addEventListener('change', (e) => {
        const isVip = typeof window !== 'undefined' && !!window.IS_VIP_APP;
        const email = localStorage.getItem('sulapfoto_verified_email');
        if (!isVip && e.target.checked) {
          e.target.checked = false;
          if (typeof PARAREL_GENERATE !== 'undefined') {
            PARAREL_GENERATE = "FALSE";
          }
          if (window.showBoostModeVipOnlyPopup) {
            window.showBoostModeVipOnlyPopup();
          }
          updateBoostLabel();
          return;
        }
        if (e.target.checked && userBoostQuota <= 0) {
          e.target.checked = false;
          if (window.showBoostTopUpModal) {
            window.showBoostTopUpModal();
          } else if (window.showServerToast) {
            window.showServerToast("Kuota Boost Habis! Silakan isi ulang.");
          } else {
            alert("Kuota Boost Habis! Silakan isi ulang.");
          }
          updateBoostLabel();
          return;
        }
        // Update variable
        if (typeof PARAREL_GENERATE !== 'undefined') {
          PARAREL_GENERATE = e.target.checked ? "TRUE" : "FALSE";
        }
        // Show/Hide server dropdown
        const boostServerContainer = document.getElementById('boost-server-container');
        if (boostServerContainer && typeof BASE_URLS !== 'undefined' && BASE_URLS.length > 1) {
          if (e.target.checked) {
            boostServerContainer.classList.remove('hidden');
          } else {
            boostServerContainer.classList.add('hidden');
          }
        }
        // Save status to server
        if (email) {
          fetch(`server/boost_quota.php?action=set_boost_status&email=${encodeURIComponent(email)}&status=${e.target.checked}&_ts=${Date.now()}`)
          .catch(err => console.error('Failed to save boost status', err));
        }
        if (window.showServerToast) {
          const toast = window.showServerToast(PARAREL_GENERATE === "TRUE" ? "Boost Mode Aktif (10x Lebih Cepat)" : "Boost Mode Nonaktif");
          if (window.hideServerToast) {
            setTimeout(() => {
              window.hideServerToast(toast);
            }, 5000);
          }
        }
        updateBoostLabel();
      });
    }
    // Initialize Boost Server Dropdown
    const boostServerContainer = document.getElementById('boost-server-container');
    const boostServerSelect = document.getElementById('boost-server-select');
    if (boostServerContainer && boostServerSelect && typeof BASE_URLS !== 'undefined' && BASE_URLS.length > 1) {
      // Initial visibility check based on toggle
      if (boostToggle && boostToggle.checked) {
        boostServerContainer.classList.remove('hidden');
      } else {
        boostServerContainer.classList.add('hidden');
      }
      // Clear existing options except first
      while (boostServerSelect.options.length > 1) {
        boostServerSelect.remove(1);
      }
      BASE_URLS.forEach((url, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.text = `Server ${index + 1}`;
        boostServerSelect.appendChild(option);
      });
      // Force random/default on refresh
      localStorage.removeItem('sulapfoto_boost_server');
      boostServerSelect.value = 'random';
      // Event listener - Save selection to localStorage
      boostServerSelect.addEventListener('change', (e) => {
        localStorage.setItem('sulapfoto_boost_server', e.target.value);
      });
    }
    // Intercept fetch to decrease quota
    const originalFetch = window.fetch;
    window.fetch = async function (input, init) {
      const url = (typeof input === 'string') ? input : (input.url || '');
      const isBoostActive = (typeof PARAREL_GENERATE !== 'undefined' && PARAREL_GENERATE === "TRUE");
      // Check for generate endpoints
      const isGenerate = url.includes('generate') || (url.includes('proxy.php') && url.includes('path=/generate'));
      const isNano = url.includes('nanobananapro');
      if (isBoostActive && (isGenerate || isNano)) {
        const email = localStorage.getItem('sulapfoto_verified_email');
        if (email) {
          if (userBoostQuota <= 0) {
            await fetchBoostQuota(); // Re-check
            if (userBoostQuota <= 0) {
              if (window.showServerToast) {
                const toast = window.showServerToast("Kuota boost habis!");
                if (window.hideServerToast) {
                  setTimeout(() => {
                    window.hideServerToast(toast);
                  }, 5000);
                }
              }
              throw new Error("Boost Quota Exceeded");
            }
          }
          try {
            const response = await originalFetch.apply(this, arguments);
            if (response.ok) {
              try {
                const clone = response.clone();
                const data = await clone.json();
                if (data && (data.success === true || data.success === "true")) {
                  // Decrease quota in background
                  fetch('server/boost_quota.php?action=decrease_quota&email=' + encodeURIComponent(email) + '&amount=1&_ts=' + Date.now())
                  .then(res => res.json())
                  .then(data => {
                    if (data.success) {
                      userBoostQuota = parseInt(data.quota);
                      updateBoostLabel();
                    }
                  })
                  .catch(err => console.error('Error decreasing quota', err));
                }
              } catch (e) {
                // Ignore JSON parse errors
              }
            }
            return response;
          } catch (err) {
            throw err;
          }
        }
      }
      return originalFetch.apply(this, arguments);
    };
  });
}
