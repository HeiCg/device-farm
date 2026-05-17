# App Explorer Report: com.example.shop

**Platform:** Android | **Date:** 2026-05-16

## Summary

| Metric | Value |
|--------|-------|
| Screens discovered | 5 |
| Transitions mapped | 7 |
| Interactive elements | 5 |
| Elements explored | 3 (60%) |

## Navigation Map

```mermaid
graph TD
    home["Shop Home"]
    shop["Shop"]
    product["Product Detail"]
    cart["Your Cart"]
    settings["Settings"]
    home --> |"tap: Shop tab"| shop
    shop --> |"tap: Product card"| product
    product --> |"tap: Add to cart"| cart
    home --> |"tap: Settings tab"| settings
    cart --> |"key:back"| home
    settings --> |"key:back"| home
    product --> |"key:back"| shop
```

## Screen Inventory

### 1. Shop Home (`home`)

![Shop Home](/api/artifacts/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01/raw)

**Elements:**
- Shop tab (tab) -> `shop`
- Settings tab (tab) (unexplored)

---

### 2. Shop (`shop`)

![Shop](/api/artifacts/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02/raw)

**Elements:**
- Product card (list_item) -> `product`

---

### 3. Product Detail (`product`)

![Product Detail](/api/artifacts/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03/raw)

**Elements:**
- Add to cart (button) -> `cart`

---

### 4. Your Cart (`cart`)

![Your Cart](/api/artifacts/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb04/raw)

**Elements:**
- Checkout (button) (unexplored)

**Notes:** Demo cart never persists

---

### 5. Settings (`settings`)

![Settings](/api/artifacts/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05/raw)

---

## User Paths

1. Shop Home -> Shop -> Product Detail -> Your Cart
2. Shop Home -> Settings

## Edge Cases

| Screen | Title | Notes |
|--------|-------|-------|
| `cart` | Your Cart | Demo cart never persists |
