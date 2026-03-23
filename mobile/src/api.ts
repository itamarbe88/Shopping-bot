import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Configuration ──────────────────────────────────────────────────────────────
export const BASE_URL = "https://salvador-api-49266329932.europe-west1.run.app";

// ── Auth helpers ────────────────────────────────────────────────────────────────
let _onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(fn: () => void) { _onUnauthorized = fn; }

async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await AsyncStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extra };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, options);
  if (res.status === 401) {
    await AsyncStorage.multiRemove(["auth_token", "auth_user"]);
    _onUnauthorized?.();
    throw new Error("Session expired. Please sign in again.");
  }
  return res;
}

// ── Types ──────────────────────────────────────────────────────────────────────
export interface InventoryItem {
  item_name: string;
  unit: string;
  current_quantity: string;
  desired_quantity: string;
  days_until_restock: string;
  last_purchased_date: string;
  next_purchase_date: string;
  type?: string;
}

export interface ShoppingItem {
  item_name: string;
  quantity_to_buy: number;
  current_quantity: number;
  next_purchase_date?: string;
  last_purchased_date?: string;
  is_temporary?: boolean;
  item_type?: string;
  purchase_reason?: string;
}

export interface ShoppingListResponse {
  shopping_list: ShoppingItem[];
  dry_run: boolean;
  simulation_depletions?: object[];
  message?: string;
}

export interface PurchaseItem {
  item_name: string;
  quantity_bought: number;
}

// ── API calls ──────────────────────────────────────────────────────────────────
export async function fetchInventory(): Promise<InventoryItem[]> {
  const res = await apiFetch(`${BASE_URL}/inventory`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch inventory");
  return res.json();
}

export async function fetchShoppingList(dryRun: boolean): Promise<ShoppingListResponse> {
  const res = await apiFetch(`${BASE_URL}/shopping-list?dry_run=${dryRun}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch shopping list");
  return res.json();
}

export async function fetchLastShoppingList(): Promise<ShoppingListResponse> {
  const res = await apiFetch(`${BASE_URL}/shopping-list/last`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch last shopping list");
  return res.json();
}

export async function addTemporaryItem(item_name: string, quantity: number): Promise<void> {
  const res = await apiFetch(`${BASE_URL}/inventory/temporary`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ item_name, quantity }),
  });
  if (!res.ok) throw new Error("Failed to add temporary item");
}

export async function addManualItem(item_name: string, quantity: number): Promise<void> {
  const res = await apiFetch(`${BASE_URL}/inventory/manual`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ item_name, quantity }),
  });
  if (!res.ok) throw new Error("Failed to add manual item");
}

export async function removeFromShoppingList(item_name: string): Promise<void> {
  await apiFetch(`${BASE_URL}/shopping-list/item/${encodeURIComponent(item_name)}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
}

export async function confirmPurchases(purchases: PurchaseItem[]): Promise<void> {
  const res = await apiFetch(`${BASE_URL}/shopping-list/confirm`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ purchases }),
  });
  if (!res.ok) throw new Error("Failed to confirm purchases");
}

export async function upsertInventoryItem(item: {
  item_name: string;
  unit: string;
  current_quantity: number;
  desired_quantity: number;
  days_until_restock: number;
  last_purchased_date?: string | null;
}): Promise<void> {
  const res = await apiFetch(`${BASE_URL}/inventory/item`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error("Failed to save inventory item");
}

export interface VoiceMatchedItem {
  spoken: string;
  matched: string;
  current_quantity: string;
  desired_quantity: string;
}

export interface VoiceResponse {
  found: VoiceMatchedItem[];
  not_found: string[];
  raw_text: string;
  parsed_items: string[];
}

export async function processVoiceItems(speech_text: string): Promise<VoiceResponse> {
  const res = await apiFetch(`${BASE_URL}/inventory/voice`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ speech_text }),
  });
  if (!res.ok) throw new Error("Failed to process voice input");
  return res.json();
}

export async function deleteInventoryItem(item_name: string, type?: string): Promise<void> {
  const url = type
    ? `${BASE_URL}/inventory/item/${encodeURIComponent(item_name)}?item_type=${encodeURIComponent(type)}`
    : `${BASE_URL}/inventory/item/${encodeURIComponent(item_name)}`;
  const res = await apiFetch(url, { method: "DELETE", headers: await authHeaders() });
  if (!res.ok) throw new Error("Failed to delete inventory item");
}

export async function fetchHousehold(): Promise<string | null> {
  try {
    const res = await apiFetch(`${BASE_URL}/household/me`, { headers: await authHeaders() });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = await res.json();
    return data.household_id;
  } catch {
    return null;
  }
}

export async function createHousehold(): Promise<string> {
  const res = await apiFetch(`${BASE_URL}/household/create`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to create household");
  const data = await res.json();
  return data.household_id;
}

export async function joinHousehold(code: string): Promise<string> {
  const res = await apiFetch(`${BASE_URL}/household/join`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ code }),
  });
  if (res.status === 404) throw new Error("קוד לא נמצא");
  if (!res.ok) throw new Error("Failed to join household");
  const data = await res.json();
  return data.household_id;
}
