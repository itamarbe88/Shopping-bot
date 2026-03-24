import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from google.oauth2 import id_token
from google.auth.transport import requests as grequests
from pydantic import BaseModel

from api.logic import (
    _load,
    _save,
    confirm_shopping,
    create_household,
    delete_item,
    delete_last_list,
    generate_shopping_list,
    get_household_id,
    get_inventory,
    get_item_image,
    item_has_image,
    join_household,
    process_voice_items,
    read_last_list,
    list_items_with_images,
    save_item_image,
    upsert_item,
    write_last_list,
)

GOOGLE_CLIENT_ID = os.environ["GOOGLE_CLIENT_ID"]

app = FastAPI(title="Grocery Inventory API")

@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    print(f"[VALIDATION] {exc.errors()}")
    return JSONResponse(status_code=422, content={"detail": exc.errors()})

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth dependencies ───────────────────────────────────────────────────────────

def _verify_token(authorization: str) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization[7:]
    try:
        info = id_token.verify_oauth2_token(token, grequests.Request(), GOOGLE_CLIENT_ID)
        print(f"[AUTH] user_id={info['sub']} email={info.get('email')}")
        return info["sub"]
    except Exception as e:
        print(f"[AUTH] Token verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid or expired token")


async def get_user_id(authorization: str = Header(...)) -> str:
    return _verify_token(authorization)


async def get_hh_id(authorization: str = Header(...)) -> str:
    user_id = _verify_token(authorization)
    hh = get_household_id(user_id)
    if not hh:
        raise HTTPException(status_code=403, detail="No household — create or join one first")
    return hh


# ── Household ───────────────────────────────────────────────────────────────────

@app.get("/household/me")
def household_me(user_id: str = Depends(get_user_id)):
    hh = get_household_id(user_id)
    if not hh:
        raise HTTPException(status_code=404, detail="No household")
    return {"household_id": hh}


@app.post("/household/create")
def household_create(user_id: str = Depends(get_user_id)):
    hh = create_household(user_id)
    return {"household_id": hh}


class JoinRequest(BaseModel):
    code: str


@app.post("/household/join")
def household_join(body: JoinRequest, user_id: str = Depends(get_user_id)):
    ok = join_household(user_id, body.code)
    if not ok:
        raise HTTPException(status_code=404, detail="Household not found")
    return {"household_id": body.code.upper().strip()}


# ── Inventory ──────────────────────────────────────────────────────────────────

@app.get("/inventory")
def read_inventory(hh: str = Depends(get_hh_id)):
    return get_inventory(hh)


class UpsertItemRequest(BaseModel):
    item_name: str
    unit: str = ""
    current_quantity: int
    desired_quantity: int
    days_until_restock: int
    last_purchased_date: str | None = None


@app.post("/inventory/item")
def create_or_update_item(body: UpsertItemRequest, hh: str = Depends(get_hh_id)):
    return upsert_item(
        household_id=hh,
        item_name=body.item_name,
        unit=body.unit,
        current_quantity=body.current_quantity,
        desired_quantity=body.desired_quantity,
        days_until_restock=body.days_until_restock,
        last_purchased_date=body.last_purchased_date,
    )


@app.delete("/inventory/item/{item_name}")
def remove_item(item_name: str, item_type: str | None = None, hh: str = Depends(get_hh_id)):
    result = delete_item(hh, item_name, item_type=item_type)
    if not result["success"]:
        raise HTTPException(status_code=404, detail=result["message"])
    return result


# ── Shopping list ──────────────────────────────────────────────────────────────

@app.get("/shopping-list/last")
def last_shopping_list(hh: str = Depends(get_hh_id)):
    cached_items = read_last_list(hh)
    cached_names = {i["item_name"] for i in cached_items}
    for item in _load(hh):
        item_type = item.get("type", "")
        if item_type not in ("manual", "temporary"):
            continue
        if item["item_name"] in cached_names:
            continue
        try:
            desired = float(item["desired_quantity"])
            current = float(item["current_quantity"])
        except (ValueError, KeyError):
            continue
        cached_items.append({
            "item_name": item["item_name"],
            "quantity_to_buy": int(desired),
            "current_quantity": int(current),
            "is_temporary": item_type == "temporary",
            "item_type": item_type,
            "last_purchased_date": item.get("last_purchased_date") or None,
        })
    return {"shopping_list": cached_items, "cached": len(cached_items) > 0}


@app.get("/shopping-list")
def shopping_list(dry_run: bool = False, hh: str = Depends(get_hh_id)):
    return generate_shopping_list(hh, dry_run=dry_run)


class PurchaseItem(BaseModel):
    item_name: str
    quantity_bought: int


class ConfirmRequest(BaseModel):
    purchases: list[PurchaseItem]


@app.delete("/shopping-list/item/{item_name}")
def remove_from_shopping_list(item_name: str, hh: str = Depends(get_hh_id)):
    items = read_last_list(hh)
    items = [i for i in items if i["item_name"] != item_name]
    write_last_list(hh, items)
    return {"success": True}


@app.post("/shopping-list/confirm")
def confirm(body: ConfirmRequest, hh: str = Depends(get_hh_id)):
    result = confirm_shopping(hh, [p.model_dump() for p in body.purchases])
    return result


class TempItemRequest(BaseModel):
    item_name: str
    quantity: int


@app.post("/inventory/temporary")
def add_temporary_item(body: TempItemRequest, hh: str = Depends(get_hh_id)):
    items = _load(hh)
    items.append({
        "item_name": body.item_name,
        "unit": "",
        "current_quantity": "0",
        "desired_quantity": str(body.quantity),
        "days_until_restock": "7",
        "last_purchased_date": "",
        "type": "temporary",
    })
    _save(items, hh)
    return {"success": True, "item": body.item_name, "quantity": body.quantity}


# ── Item images ──────────────────────────────────────────────────────────────

import base64

class ImageUploadRequest(BaseModel):
    item_name: str
    image_base64: str  # JPEG bytes encoded as base64, max 200KB

MAX_IMAGE_BYTES = 200 * 1024  # 200 KB

@app.post("/inventory/image")
def upload_item_image(body: ImageUploadRequest, hh: str = Depends(get_hh_id)):
    image_bytes = base64.b64decode(body.image_base64)
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image exceeds 200KB limit")
    save_item_image(hh, body.item_name, image_bytes)
    return {"success": True}

@app.get("/inventory/image/{item_name}")
def download_item_image(item_name: str, hh: str = Depends(get_hh_id)):
    data = get_item_image(hh, item_name)
    if data is None:
        raise HTTPException(status_code=404, detail="No image for this item")
    return {"image_base64": base64.b64encode(data).decode()}

@app.get("/inventory/image-exists/{item_name}")
def check_item_image(item_name: str, hh: str = Depends(get_hh_id)):
    return {"exists": item_has_image(hh, item_name)}

@app.get("/inventory/images")
def list_images(hh: str = Depends(get_hh_id)):
    return {"items": list_items_with_images(hh)}


class VoiceRequest(BaseModel):
    speech_text: str


@app.post("/inventory/voice")
def voice_inventory(body: VoiceRequest, hh: str = Depends(get_hh_id)):
    return process_voice_items(hh, body.speech_text)


@app.post("/inventory/manual")
def add_manual_item(body: TempItemRequest, hh: str = Depends(get_hh_id)):
    items = _load(hh)
    items = [i for i in items if not (i["item_name"] == body.item_name and i.get("type") == "manual")]
    items.append({
        "item_name": body.item_name,
        "unit": "",
        "current_quantity": "0",
        "desired_quantity": str(body.quantity),
        "days_until_restock": "7",
        "last_purchased_date": "",
        "type": "manual",
    })
    _save(items, hh)
    return {"success": True, "item": body.item_name, "quantity": body.quantity}
