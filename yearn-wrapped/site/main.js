// main.js · landing page UI: wallet connect, address/ENS entry, toasts.

// Handlers below initialize immediately; optional graphics join one presentation.
const canvas = document.getElementById("stage");
const entrance = window.wrappedEntrance;
let hero = {};
const fontsReady = Promise.all([
  document.fonts.load('400 16px "Aeonik"'),
  document.fonts.load('700 16px "Aeonik"'),
  document.fonts.load('400 16px "Aeonik Mono"'),
]);
fontsReady.then(() => entrance.fontsReady()).catch(() => {});
import("./vendor/scene/hero.js").then(async ({ createHero }) => {
  if (!entrance.pending()) return;
  const scene = await createHero(canvas, {
    isActive: () => entrance.pending() || document.documentElement.dataset.presentation === "3d",
  });
  if (!scene) return;
  if (!entrance.sceneReady()) { scene.dispose(); return; }
  hero = scene;
  const present = () => {
    if (document.documentElement.dataset.presentation === "3d") scene.start();
    else scene.dispose();
  };
  if (entrance.pending()) addEventListener("wrapped:visible", present, { once: true });
  else present();
}).catch((error) => {
  entrance.sceneFailed();
  console.warn("3D background unavailable; using static background.", error);
});
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const connectBtn = document.getElementById("connect-btn");
const connectLabel = connectBtn.querySelector(".btn-label");
const form = document.getElementById("entry-form");
const input = document.getElementById("address-input");
const replayBtn = document.getElementById("replay-btn");
const replayLabel = replayBtn.querySelector(".btn-label");
const status = document.getElementById("entry-status");
const toast = document.getElementById("toast");

const entry = document.getElementById("entry");

let connectedAddress = null;
// The chosen ENS name stays separate from the connected account.
let resolvedEns = null;

function shortAddress(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Warm the build before the click lands. The service coalesces concurrent builds
// and caches a finished payload for 15 minutes, so starting the build the moment
// an address becomes valid means the button press usually opens something that is
// already waiting instead of a spinner.
function prefetch(addr) {
  fetch(`api/recap?address=${encodeURIComponent(addr)}&year=2026`, { cache: "no-store" }).catch(() => {});
}

function setReady(target, note) {
  entry.classList.toggle("is-ready", Boolean(target));
  if (target) prefetch(target);
  if (note !== undefined) setStatus(note);
}

function flagInvalid() {
  input.classList.add("is-invalid");
  setTimeout(() => input.classList.remove("is-invalid"), 900);
}

// Cover the moving scene completely before navigating. The next document paints
// this same opaque curtain before releasing it over a ready loader or recap.
let launched = false;
function goReplay(addr) {
  if (launched) return;
  launched = true;
  let url = `replay.html?address=${encodeURIComponent(addr)}`;
  // The name travels with the address. The landing already paid for the lookup, and
  // the deck, its outro and the share image would otherwise fall back to six
  // characters and an ellipsis.
  if (resolvedEns?.name && resolvedEns.addr?.toLowerCase() === String(addr).toLowerCase()) {
    url += `&name=${encodeURIComponent(resolvedEns.name)}`;
  }
  if (hero.launch) hero.launch();
  try { sessionStorage.setItem("wrapped-launch", "1"); } catch (err) {}
  const flash = document.getElementById("launch-flash");
  let navigating = false;
  const navigate = () => {
    if (navigating) return;
    navigating = true;
    clearTimeout(fallback);
    location.href = url;
  };
  flash.addEventListener("transitionend", event => {
    if (event.target === flash && event.propertyName === "opacity") {
      // Let the fully covered frame paint before the old document can freeze.
      requestAnimationFrame(() => requestAnimationFrame(navigate));
    }
  });
  const fallback = setTimeout(() => {
    // A busy GPU or interrupted CSS transition still needs an opaque last frame.
    flash.style.transition = "none";
    flash.style.opacity = "1";
    requestAnimationFrame(() => requestAnimationFrame(navigate));
  }, reducedMotion ? 260 : 800);
  document.body.classList.add("launching");
}

let toastTimer = null;
function showToast(message, ms = 3200) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), ms);
}

function setStatus(html) {
  status.innerHTML = html;
}

// --- Wallet connect ----------------------------------------------------

// The official provider and its modal are bundled together and served locally.
// Initialization only prepares the client; accounts are requested on a click.
const WC_PROJECT_ID = "2eaa1bd097db18926eb024849fe35341";
let wcProviderPromise = null;
async function walletConnectProvider() {
  if (!WC_PROJECT_ID) throw new Error("walletconnect not configured");
  if (!wcProviderPromise) {
    wcProviderPromise = import("./vendor/walletconnect.js")
      .then(({ EthereumProvider }) => EthereumProvider.init({
        projectId: WC_PROJECT_ID,
        chains: [1, 8453],
        showQrModal: true,
        metadata: {
          name: "yearn wrapped",
          description: "your year onchain, wrapped.",
          url: location.origin,
          icons: [new URL("assets/yearn-symbol-white-rgb.png", location.href).href],
        },
      }))
      .then(async (provider) => {
        // Register the pinned SDK's closed modal before the first click.
        // This does not open it or request wallet accounts.
        await provider.modal?.injectModalUi?.();
        return provider;
      });
    wcProviderPromise.catch(() => { wcProviderPromise = null; });
    wcProviderPromise.then((p) => { window.__wcProvider = p; }).catch(() => {});
  }
  return wcProviderPromise;
}

// Prepare the modal after first paint; a click shares the same initialization.
function warmWallet() {
  if (window.ethereum || !WC_PROJECT_ID) return;
  // Fetch as soon as the first scene is committed; prepare the modal after paint.
  // This overlaps its download with animation without competing for scene bytes.
  const preload = document.createElement("link");
  preload.rel = "modulepreload";
  preload.href = "vendor/walletconnect.js";
  preload.fetchPriority = "low";
  document.head.appendChild(preload);
  requestAnimationFrame(() => setTimeout(() => walletConnectProvider().catch(() => {}), 0));
}
if (entrance.pending()) addEventListener("wrapped:visible", warmWallet, { once: true });
else warmWallet();

connectBtn.addEventListener("click", async () => {
  if (connectedAddress) {
    // Already connected: replay instead.
    goReplay(connectedAddress);
    return;
  }
  connectLabel.textContent = "Connecting…";
  try {
    let accounts = null;
    if (window.ethereum) {
      accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    } else {
      // No injected wallet: WalletConnect's QR flow covers the rest of the
      // mobile wallets, and the address is all the deck ever needs. The modal
      // only opens once the provider is initialized, so say so instead of
      // leaving the tap silent.
      setStatus('<span class="dim">connecting · the wallet modal opens next</span>');
      const provider = await walletConnectProvider();
      await provider.enable();
      accounts = provider.accounts;
    }
    if (!accounts || !accounts.length) throw new Error("no accounts");
    if (!ADDR_RE.test(accounts[0])) throw new Error("invalid wallet account");
    connectedAddress = accounts[0];
    bindWallet(window.ethereum || await walletConnectProvider());
    connectLabel.textContent = shortAddress(connectedAddress);
    validate();
    if (!input.value.trim()) setReady(connectedAddress, '<span class="ok">●</span> wallet connected · press enter to replay');
    if (!input.value.trim()) replayBtn.focus({ preventScroll: true });
    showToast("Wallet connected.");
  } catch (err) {
    connectLabel.textContent = "Connect wallet";
    setStatus('<span class="err">connection cancelled</span>');
    if (!window.ethereum && !WC_PROJECT_ID) {
      showToast("No injected wallet found. Paste an address instead.");
      setStatus('<span class="err">no injected wallet, paste an address</span>');
      input.focus();
    }
  }
});

// --- Address / ENS entry ----------------------------------------------

const ENS_RE = /^[a-zA-Z0-9._-]+\.[a-z]{2,}$/i;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

let ethersPromise = null;
async function resolveEns(name) {
  if (!ethersPromise) {
    ethersPromise = import("https://esm.sh/ethers@6.13.4");
  }
  const ethers = await ethersPromise;
  const rpcs = [
    "https://cloudflare-eth.com",
    "https://ethereum-rpc.publicnode.com",
  ];
  let lastErr = null;
  for (const rpc of rpcs) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc);
      const addr = await Promise.race([
        provider.resolveName(name),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000)),
      ]);
      if (addr) return addr;
      lastErr = new Error("not found");
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function handleSubmit(event) {
  event.preventDefault();
  const value = input.value.trim();

  // Prefer a manual entry; fall back to the connected wallet.
  if (ADDR_RE.test(value)) {
    goReplay(value);
    return;
  }

  if (ENS_RE.test(value)) {
    // Typing an ENS name already resolved it, so this is the fast path.
    if (resolvedEns && resolvedEns.name === value) {
      goReplay(resolvedEns.addr);
      return;
    }
    replayLabel.textContent = "Resolving…";
    try {
      const addr = await resolveEns(value);
      if (input.value.trim() !== value) return;
      resolvedEns = { name: value, addr };
      goReplay(addr);
    } catch (err) {
      if (input.value.trim() !== value) return;
      setStatus(`<span class="err">couldn't resolve ${value} on mainnet</span>`);
      flagInvalid();
      replayLabel.textContent = "Replay my year";
      entry.classList.remove("is-ready");
    }
    return;
  }

  if (!value && connectedAddress) {
    goReplay(connectedAddress);
    return;
  }

  setStatus('<span class="err">that doesn\'t look like an address or ENS name</span>');
  flagInvalid();
}

form.addEventListener("submit", handleSubmit);

// Validation runs while the user types, not on submit: an address is a long
// string and nobody wants to discover a typo after pressing the button. An ENS
// name gets looked up here too, which doubles as a warm-up for the build, so the
// deck opens on a cached payload rather than a cold one.
let resolveTimer = null;
let resolveSeq = 0;

function validate() {
  const value = input.value.trim();
  clearTimeout(resolveTimer);
  const seq = ++resolveSeq;
  replayLabel.textContent = "Replay my year";

  if (ADDR_RE.test(value)) {
    setReady(value, `<span class="ok">●</span> ${shortAddress(value)} · replay ready`);
    return;
  }

  if (ENS_RE.test(value)) {
    if (resolvedEns && resolvedEns.name === value) {
      setReady(resolvedEns.addr, `<span class="ok">●</span> ${value} → ${shortAddress(resolvedEns.addr)} · replay ready`);
      return;
    }
    setReady(null, `<span class="dim">resolving ${value} on mainnet…</span>`);
    resolveTimer = setTimeout(async () => {
      try {
        const addr = await resolveEns(value);
        if (seq !== resolveSeq || input.value.trim() !== value) return;
        resolvedEns = { name: value, addr };
        setReady(addr, `<span class="ok">●</span> ${value} → ${shortAddress(addr)} · replay ready`);
      } catch (err) {
        if (seq !== resolveSeq || input.value.trim() !== value) return;
        setReady(null, `<span class="err">couldn't resolve ${value} on mainnet</span>`);
      }
    }, 420);
    return;
  }

  setReady(!value ? connectedAddress : null, !value && connectedAddress
    ? `<span class="ok">●</span> ${shortAddress(connectedAddress)} · replay ready` : "");
}

input.addEventListener("input", validate);

const watchedWallets = new WeakSet();
function bindWallet(provider) {
  if (!provider?.on || watchedWallets.has(provider)) return;
  watchedWallets.add(provider);
  const update = (accounts) => {
    connectedAddress = ADDR_RE.test(accounts?.[0]) ? accounts[0] : null;
    connectLabel.textContent = connectedAddress ? shortAddress(connectedAddress) : "Connect wallet";
    validate();
  };
  provider.on("accountsChanged", update);
  provider.on("disconnect", () => update([]));
}
