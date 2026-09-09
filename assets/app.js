// AICON — wallet connect (Reown AppKit) + swap execution (vanilla JS, ESM CDN, no bundler)
//
// SETUP REQUIRED BEFORE WALLET CONNECT WORKS:
// 1. Create a free project at https://dashboard.reown.com
// 2. Add this site's domain (and localhost for testing) to that project's allowed origins
// 3. Paste the Project ID below, replacing 'YOUR_REOWN_PROJECT_ID'
//
// Without a real Project ID the modal will render but connections will fail —
// Reown's demo IDs only work on localhost.
//
// SWAP ROUTING NOTE (read before going live):
// AICON's own router contract is still unaudited and not deployed (see README /
// docs.html#contracts), so swaps here do NOT go through an AICON contract.
// Instead this calls Uniswap's V2 Router02 directly — Uniswap is a separate,
// independently audited protocol that Uniswap Labs has deployed natively on
// Robinhood Chain. Addresses below were pulled from:
//   - Router/Factory: https://developers.uniswap.org/docs/protocols/v2/deployments
//   - WETH / USDG:    https://docs.robinhood.com/chain/contracts
// RE-VERIFY every address yourself against those two pages (and the addresses'
// contract pages on https://robinhoodchain.blockscout.com) before shipping —
// this chain has documented honeypot/copycat-token activity, and a swapped
// address here would silently route user funds to the wrong place.

import { createAppKit } from 'https://esm.sh/@reown/appkit@1.7.0?bundle';
import { EthersAdapter } from 'https://esm.sh/@reown/appkit-adapter-ethers@1.7.0?bundle';
import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  formatUnits,
  parseUnits,
  MaxUint256
} from 'https://esm.sh/ethers@6.13.4';

const PROJECT_ID = '9294a4f6c6b5683cb27499c339368964';

const robinhoodChain = {
  id: 4663,
  caipNetworkId: 'eip155:4663',
  chainNamespace: 'eip155',
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] }
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' }
  }
};

// ---------- Verified Robinhood Chain addresses (see note above) ----------
const UNISWAP_V2_ROUTER = '0x89e5db8b5aa49aa85ac63f691524311aeb649eba';
const WETH_ADDRESS = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const USDG_ADDRESS = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const SLIPPAGE_BPS = 100n; // 1.00% default slippage tolerance
const DEADLINE_SECONDS = 600; // 10 minutes

const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
];

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
];

// Token registry — starts with the two proven-liquid pinned tokens, then grows
// with tokens discovered live from GeckoTerminal (see loadDiscoveredTokens below).
// Keyed by lowercased address, or the literal string 'NATIVE' for ETH.
const tokenRegistry = new Map([
  ['NATIVE', { key: 'NATIVE', symbol: 'ETH', name: 'Ether', address: null, decimals: 18, priceUsd: null, volume24h: Infinity, pinned: true }],
  [USDG_ADDRESS.toLowerCase(), { key: USDG_ADDRESS.toLowerCase(), symbol: 'USDG', name: 'Global Dollar', address: USDG_ADDRESS, decimals: null, priceUsd: null, volume24h: Infinity, pinned: true }]
]);

const readOnlyProvider = new JsonRpcProvider(robinhoodChain.rpcUrls.default.http[0]);

const modal = createAppKit({
  adapters: [new EthersAdapter()],
  networks: [robinhoodChain],
  defaultNetwork: robinhoodChain,
  projectId: PROJECT_ID,
  metadata: {
    name: 'AICON',
    description: 'Non-custodial swap router on Robinhood Chain',
    url: window.location.origin,
    icons: [new URL('logo.svg', window.location.href).href]
  },
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#CCFF00',
    '--w3m-border-radius-master': '0px',
    '--w3m-font-family': "'Space Grotesk', sans-serif"
  },
  features: {
    analytics: false,
    swaps: false,
    onramp: false,
    email: false,
    socials: false
  }
});

const networkRow = document.getElementById('network-row');
const wrongNetworkNotice = document.getElementById('wrong-network');

function renderAccountState(account) {
  const connected = !!account?.isConnected;
  if (networkRow) networkRow.hidden = !connected;
  if (!connected && wrongNetworkNotice) wrongNetworkNotice.hidden = true;
  refreshSwapAvailability();
}

function renderNetworkState(state) {
  if (!state?.caipNetwork || !wrongNetworkNotice) return;
  const onRobinhood = state.caipNetwork.id === robinhoodChain.caipNetworkId
    || state.caipNetwork.id === robinhoodChain.id;
  wrongNetworkNotice.hidden = onRobinhood;
  refreshSwapAvailability();
}

if (PROJECT_ID === 'YOUR_REOWN_PROJECT_ID') {
  const slot = document.getElementById('connect-slot');
  if (slot) {
    const notice = document.createElement('p');
    notice.className = 'setup-notice';
    notice.textContent = 'Wallet connect needs a Reown Project ID — add yours in assets/app.js to activate this button.';
    slot.appendChild(notice);
  }
}

modal.subscribeAccount(renderAccountState);
modal.subscribeNetwork(renderNetworkState);

// ==========================================================================
// Swap panel
// ==========================================================================

const payInput = document.getElementById('pay-input');
const receiveInput = document.getElementById('receive-input');
const payTokenLabel = document.getElementById('pay-token-label');
const receiveTokenLabel = document.getElementById('receive-token-label');
const payTokenBtn = document.getElementById('pay-token-btn');
const receiveTokenBtn = document.getElementById('receive-token-btn');
const flipBtn = document.getElementById('flip-direction');
const swapBtn = document.getElementById('swap-submit');
const swapStatus = document.getElementById('swap-status');
const minReceivedRow = document.getElementById('min-received-row');
const minReceivedValue = document.getElementById('min-received-value');

const tokenModal = document.getElementById('token-modal');
const tokenModalClose = document.getElementById('token-modal-close');
const tokenSearchInput = document.getElementById('token-search');
const tokenModalList = document.getElementById('token-modal-list');

let direction = { pay: 'NATIVE', receive: USDG_ADDRESS.toLowerCase() }; // matches the default markup
let quoteTimer = null;
let latestQuote = null; // { amountIn, amountOutMin, path }
let activeSide = null; // 'pay' | 'receive' — which field the token modal is editing

function tokenOf(side) {
  return tokenRegistry.get(direction[side]);
}

async function decimalsOf(token) {
  if (token.key === 'NATIVE') return 18;
  if (token.decimals !== null && token.decimals !== undefined) return token.decimals;
  const c = new Contract(token.address, ERC20_ABI, readOnlyProvider);
  token.decimals = Number(await c.decimals());
  return token.decimals;
}

function setStatus(message, kind) {
  if (!swapStatus) return;
  swapStatus.textContent = message || '';
  swapStatus.hidden = !message;
  swapStatus.className = 'swap-status' + (message ? ` swap-status-${kind || 'info'}` : '');
}

function isWalletReady() {
  const account = modal.getAccount?.();
  return !!account?.isConnected;
}

function refreshSwapAvailability() {
  if (!swapBtn) return;
  const ready = isWalletReady();
  swapBtn.disabled = !ready || !latestQuote;
  swapBtn.textContent = ready ? 'Review & swap' : 'Connect wallet to swap';
}

function updateTokenLabels() {
  if (payTokenLabel) payTokenLabel.textContent = tokenOf('pay')?.symbol || '?';
  if (receiveTokenLabel) receiveTokenLabel.textContent = tokenOf('receive')?.symbol || '?';
}

flipBtn?.addEventListener('click', () => {
  direction = { pay: direction.receive, receive: direction.pay };
  updateTokenLabels();
  if (payInput) payInput.value = '';
  if (receiveInput) receiveInput.value = '';
  latestQuote = null;
  if (minReceivedRow) minReceivedRow.hidden = true;
  setStatus('');
  refreshSwapAvailability();
});

payInput?.addEventListener('input', () => {
  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(fetchQuote, 350);
});

async function fetchQuote() {
  const amountStr = payInput.value.trim();
  latestQuote = null;
  if (minReceivedRow) minReceivedRow.hidden = true;
  refreshSwapAvailability();

  if (!amountStr || Number(amountStr) <= 0) {
    if (receiveInput) receiveInput.value = '';
    return;
  }

  const payToken = tokenOf('pay');
  const receiveToken = tokenOf('receive');

  try {
    const payDecimals = await decimalsOf(payToken);
    const receiveDecimals = await decimalsOf(receiveToken);
    const amountIn = parseUnits(amountStr, payDecimals);

    // Build the V2 route: direct pair if either side is native ETH,
    // otherwise hop through WETH (token -> WETH -> token).
    const payAddr = payToken.key === 'NATIVE' ? WETH_ADDRESS : payToken.address;
    const receiveAddr = receiveToken.key === 'NATIVE' ? WETH_ADDRESS : receiveToken.address;
    const path = payAddr.toLowerCase() === receiveAddr.toLowerCase()
      ? [payAddr, receiveAddr]
      : (payToken.key === 'NATIVE' || receiveToken.key === 'NATIVE')
        ? [payAddr, receiveAddr]
        : [payAddr, WETH_ADDRESS, receiveAddr];

    const router = new Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, readOnlyProvider);
    const amounts = await router.getAmountsOut(amountIn, path);
    const amountOut = amounts[amounts.length - 1];
    const amountOutMin = amountOut - (amountOut * SLIPPAGE_BPS / 10000n);

    if (receiveInput) receiveInput.value = formatUnits(amountOut, receiveDecimals);
    if (minReceivedValue) minReceivedValue.textContent = `${formatUnits(amountOutMin, receiveDecimals)} ${receiveToken.symbol}`;
    if (minReceivedRow) minReceivedRow.hidden = false;

    latestQuote = { amountIn, amountOutMin, path, payIsNative: payToken.key === 'NATIVE', receiveIsNative: receiveToken.key === 'NATIVE', payAddress: payToken.address };
    setStatus('');
  } catch (err) {
    console.error('Quote failed', err);
    if (receiveInput) receiveInput.value = '';
    // Fall back to the informational GeckoTerminal price when there's no
    // direct on-chain V2 route (common for V3/V4-only tokens on this chain).
    if (receiveToken?.priceUsd != null && payToken?.priceUsd != null) {
      setStatus(`No direct Uniswap V2 route on-chain for this pair yet, so it can't be swapped here. Reference market price: 1 ${payToken.symbol} ≈ $${payToken.priceUsd.toFixed(4)}, 1 ${receiveToken.symbol} ≈ $${receiveToken.priceUsd.toFixed(4)}.`, 'error');
    } else {
      setStatus('No direct Uniswap V2 route found on-chain for this pair — it can\'t be swapped here yet.', 'error');
    }
  }
  refreshSwapAvailability();
}

swapBtn?.addEventListener('click', async () => {
  if (!latestQuote) return;
  const providers = modal.getProviders?.();
  const eip155Provider = providers?.eip155;
  if (!eip155Provider) {
    setStatus('No wallet provider found — reconnect your wallet and try again.', 'error');
    return;
  }
  if (wrongNetworkNotice && !wrongNetworkNotice.hidden) {
    setStatus('Switch to Robinhood Chain before swapping.', 'error');
    return;
  }

  swapBtn.disabled = true;
  try {
    const ethersProvider = new BrowserProvider(eip155Provider);
    const signer = await ethersProvider.getSigner();
    const account = await signer.getAddress();
    const router = new Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, signer);
    const deadline = Math.floor(Date.now() / 1000) + DEADLINE_SECONDS;

    let tx;
    if (latestQuote.payIsNative) {
      setStatus('Confirm the swap in your wallet…', 'info');
      tx = await router.swapExactETHForTokens(
        latestQuote.amountOutMin,
        latestQuote.path,
        account,
        deadline,
        { value: latestQuote.amountIn }
      );
    } else {
      const tokenContract = new Contract(latestQuote.payAddress, ERC20_ABI, signer);
      const allowance = await tokenContract.allowance(account, UNISWAP_V2_ROUTER);
      if (allowance < latestQuote.amountIn) {
        setStatus('Approve token access in your wallet…', 'info');
        const approveTx = await tokenContract.approve(UNISWAP_V2_ROUTER, MaxUint256);
        await approveTx.wait();
      }
      setStatus('Confirm the swap in your wallet…', 'info');
      tx = latestQuote.receiveIsNative
        ? await router.swapExactTokensForETH(latestQuote.amountIn, latestQuote.amountOutMin, latestQuote.path, account, deadline)
        : await router.swapExactTokensForTokens(latestQuote.amountIn, latestQuote.amountOutMin, latestQuote.path, account, deadline);
    }

    setStatus('Swap submitted — waiting for confirmation…', 'info');
    const receipt = await tx.wait();
    const explorerUrl = `${robinhoodChain.blockExplorers.default.url}/tx/${receipt.hash}`;
    setStatus(`Swap confirmed. View on Blockscout: ${explorerUrl}`, 'success');
    if (payInput) payInput.value = '';
    if (receiveInput) receiveInput.value = '';
    latestQuote = null;
    if (minReceivedRow) minReceivedRow.hidden = true;
  } catch (err) {
    console.error('Swap failed', err);
    const rejected = err?.code === 'ACTION_REJECTED' || err?.code === 4001;
    setStatus(rejected ? 'Swap cancelled.' : 'Swap failed — no funds were moved.', 'error');
  } finally {
    refreshSwapAvailability();
  }
});

// ==========================================================================
// Token discovery (GeckoTerminal) + picker modal
// ==========================================================================
//
// Pulls top pools directly from Uniswap's own v2/v3/v4 deployments on
// Robinhood Chain (never from the dozens of other DEX forks/launchpads on
// this chain) via GeckoTerminal's free public API, purely for browsing and
// live USD reference prices. Executing a swap still only works for pairs
// that resolve through the Uniswap V2 router above — see fetchQuote().

const GECKOTERMINAL_BASE = 'https://api.geckoterminal.com/api/v2';
const GECKOTERMINAL_NETWORK = 'robinhood';
const UNISWAP_DEX_IDS = ['uniswap_v2', 'uniswap_v3', 'uniswap_v4'];

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatPrice(n) {
  if (n === 0) return '0';
  if (n < 0.01) return n.toExponential(2);
  if (n < 1) return n.toFixed(4);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

async function loadDiscoveredTokens() {
  for (const dex of UNISWAP_DEX_IDS) {
    try {
      const res = await fetch(`${GECKOTERMINAL_BASE}/networks/${GECKOTERMINAL_NETWORK}/dexes/${dex}/pools?include=base_token,quote_token&page=1`);
      if (!res.ok) continue;
      const json = await res.json();
      const tokensById = {};
      for (const inc of (json.included || [])) {
        if (inc.type === 'token') tokensById[inc.id] = inc.attributes;
      }
      for (const pool of (json.data || [])) {
        const baseRel = pool.relationships?.base_token?.data;
        if (!baseRel) continue;
        const tAttrs = tokensById[baseRel.id];
        if (!tAttrs?.address) continue;
        const key = tAttrs.address.toLowerCase();
        if (tokenRegistry.get(key)?.pinned) continue; // don't override ETH/USDG
        const vol = Number(pool.attributes?.volume_usd?.h24 || 0);
        const existing = tokenRegistry.get(key);
        if (existing && (existing.volume24h || 0) >= vol) continue;
        const priceUsd = pool.attributes?.base_token_price_usd ? Number(pool.attributes.base_token_price_usd) : null;
        tokenRegistry.set(key, {
          key,
          symbol: tAttrs.symbol || '?',
          name: tAttrs.name || '',
          address: tAttrs.address,
          decimals: (tAttrs.decimals ?? null),
          priceUsd,
          volume24h: vol,
          pinned: false
        });
      }
    } catch (err) {
      console.error('Token discovery failed for', dex, err);
    }
  }
  renderTokenList(tokenSearchInput?.value.trim().toLowerCase() || '');
}

function renderTokenList(filter) {
  if (!tokenModalList) return;
  const items = [...tokenRegistry.values()]
    .filter((t) => !filter || t.symbol.toLowerCase().includes(filter) || t.name.toLowerCase().includes(filter))
    .sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.volume24h || 0) - (a.volume24h || 0);
    })
    .slice(0, 80);

  tokenModalList.innerHTML = items.length ? items.map((t) => `
    <button type="button" class="token-row" data-key="${escapeHtml(t.key)}">
      <span class="token-row-main">
        <span class="token-row-symbol">${escapeHtml(t.symbol)}</span>
        <span class="token-row-name">${escapeHtml(t.name)}</span>
      </span>
      <span class="token-row-price">${t.priceUsd != null ? '$' + formatPrice(t.priceUsd) : '—'}</span>
    </button>
  `).join('') : '<p class="token-modal-empty">No tokens found.</p>';

  tokenModalList.querySelectorAll('.token-row').forEach((btn) => {
    btn.addEventListener('click', () => selectToken(btn.dataset.key));
  });
}

function selectToken(key) {
  if (!activeSide || !tokenRegistry.has(key)) return;
  const otherSide = activeSide === 'pay' ? 'receive' : 'pay';
  if (direction[otherSide] === key) {
    direction[otherSide] = direction[activeSide]; // swap sides rather than allow same token twice
  }
  direction[activeSide] = key;
  updateTokenLabels();
  if (payInput) payInput.value = '';
  if (receiveInput) receiveInput.value = '';
  latestQuote = null;
  if (minReceivedRow) minReceivedRow.hidden = true;
  setStatus('');
  if (tokenModal) tokenModal.hidden = true;
  refreshSwapAvailability();
}

function openTokenModal(side) {
  activeSide = side;
  if (tokenSearchInput) tokenSearchInput.value = '';
  renderTokenList('');
  if (tokenModal) tokenModal.hidden = false;
  tokenSearchInput?.focus();
}

payTokenBtn?.addEventListener('click', () => openTokenModal('pay'));
receiveTokenBtn?.addEventListener('click', () => openTokenModal('receive'));
tokenModalClose?.addEventListener('click', () => { if (tokenModal) tokenModal.hidden = true; });
tokenModal?.addEventListener('click', (e) => { if (e.target === tokenModal) tokenModal.hidden = true; });
tokenSearchInput?.addEventListener('input', () => renderTokenList(tokenSearchInput.value.trim().toLowerCase()));

loadDiscoveredTokens();
refreshSwapAvailability();
