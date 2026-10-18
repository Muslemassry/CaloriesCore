# BiteIQ — Backend API Endpoint Specification

**Version:** 1.0
**Date:** 2026-09-02
**Audience:** Backend development team (authoritative contract).
**Scope:** Derived **only** from the current Flutter mobile application (`lib/`). No endpoints are invented; every endpoint below is traced to an existing mobile service method, model, or UI flow.

> **READ FIRST — How the mobile app is built today**
>
> The current app is a fully local prototype. There is **no HTTP client, no base
> URL, and no `.env`** in the codebase. All "backend" concerns are expressed as
> clean abstractions with in-memory or `shared_preferences`-backed mock
> implementations:
>
> | Concern | Mobile abstraction | Current implementation |
> |---|---|---|
> | Auth | `AuthService` (`lib/services/auth_service.dart`) | `MockAuthService` |
> | Meal photo AI analysis | `MealAnalysisService` (`lib/services/meal_analysis_service.dart`) | `MockMealAnalysisService` |
> | Meals | `MealRepository` (`lib/services/meal_repository.dart`) | `InMemoryMealRepository` |
> | Goals | `GoalsService` (`lib/services/goals_service.dart`) | `InMemoryGoalsService` |
> | Onboarding selections | `GoalSetupService` (`lib/services/goal_setup_service.dart`) | `SharedPreferencesGoalSetupService` |
> | Reminders / Units / Theme | `RemindersController`, `UnitsController`, `ThemeController` | `shared_preferences` (device-local) |
>
> Because of this, every endpoint below is tagged with its status:
>
> - **`CONFIRMED (mock)`** — the contract (method signature, request/response model,
>   validation) is fully traceable to the mobile code, but the HTTP call is not yet
>   implemented (mocked). **These are the endpoints the backend must implement.**
> - **`REQUIRED (missing)`** — the UI/flow logically needs it, but there is no
>   corresponding mobile code (e.g., token refresh). Implement and align with mobile.
> - **`OPTIONAL / NOT REQUIRED`** — not needed by the current app (e.g., server-side
>   logout, reminders sync). Do **not** build unless product decides to add it.

### Base URL (placeholder)

The mobile app does **not** define a base URL. All paths below are relative to a
server root that will be configured in the mobile client when the backend is wired in.
This document uses:

```
https://api.biteiq.example.com/v1
```

Substitute with the real environment URL (dev/QA/staging/prod) at deployment time.

---

# 1. Endpoint Inventory

| # | Method | Endpoint | Description | Auth | Functional area | Status |
|---|---|---|---|---|---|---|
| 1 | POST | `/auth/register` | Create an unverified account; issue a 6-digit email verification code | No | Authentication / Registration | CONFIRMED (mock) |
| 2 | POST | `/auth/verify-email` | Confirm email by verifying the 6-digit code | No | Authentication / OTP | CONFIRMED (mock) |
| 3 | POST | `/auth/resend-verification-code` | Re-issue a fresh email verification code | No | Authentication / OTP | CONFIRMED (mock) |
| 4 | POST | `/auth/login` | Authenticate and return the user profile (and tokens) | No | Authentication / Login | CONFIRMED (mock) |
| 5 | POST | `/auth/forgot-password` | Start password reset; issue a 6-digit reset code (anti-enumeration) | No | Authentication / Forgot password | CONFIRMED (mock) |
| 6 | POST | `/auth/verify-reset-code` | Verify the password-reset code | No | Authentication / Forgot password | CONFIRMED (mock) |
| 7 | POST | `/auth/resend-reset-code` | Re-issue a fresh password-reset code | No | Authentication / Forgot password | CONFIRMED (mock) |
| 8 | POST | `/auth/reset-password` | Set a new password after reset-code verification | No | Authentication / Reset password | CONFIRMED (mock) |
| 9 | POST | `/auth/refresh` | Exchange a refresh token for a new access token | Yes (refresh token) | Authentication / Token | REQUIRED (missing) |
| 10 | POST | `/auth/logout` | Revoke server-side session / tokens | Yes (Bearer) | Authentication / Logout | OPTIONAL (client-only today) |
| 11 | PATCH | `/goal-setup` | Mark the account's initial goal setup as complete | Yes (Bearer) | User / Profile | CONFIRMED (mock) |
| 12 | GET | `/goal-setup` | Load the raw onboarding selections (for "Update My Goals") | Yes (Bearer) | User / Goals | CONFIRMED (mock) |
| 13 | PUT | `/goal-setup` | Save the raw onboarding selections | Yes (Bearer) | User / Goals | CONFIRMED (mock) |
| 14 | GET | `/goals` | Get the user's daily nutrition targets | Yes (Bearer) | Nutrition / Goals | CONFIRMED (mock) |
| 15 | PUT | `/goals` | Save the user's daily nutrition targets | Yes (Bearer) | Nutrition / Goals | CONFIRMED (mock) |
| 16 | POST | `/meals/analyze` | Upload a meal photo; get AI nutrition analysis back | Yes (Bearer) | Meal Analysis (AI) | CONFIRMED (mock) |
| 17 | GET | `/meals` | List the user's meals (optionally filtered by date range) | Yes (Bearer) | Meals / History | CONFIRMED (mock) |
| 18 | GET | `/meals/{mealId}` | Get a single meal | Yes (Bearer) | Meals | CONFIRMED (mock) |
| 19 | POST | `/meals` | Create (log) a meal | Yes (Bearer) | Meal Logging | CONFIRMED (mock) |
| 20 | PUT | `/meals/{mealId}` | Update an existing meal | Yes (Bearer) | Meal Logging | CONFIRMED (mock) |
| 21 | DELETE | `/meals/{mealId}` | Delete a meal | Yes (Bearer) | Meals | CONFIRMED (mock) |

**Not required by the current app** (device-local today — document, do not build):

- Reminders (`RemindersController` → `shared_preferences`).
- Unit preferences (`UnitsController` → `shared_preferences`).
- Theme (`ThemeController` → `shared_preferences`).
- Insights/statistics (computed client-side from `/meals` data in `NutritionController`).
- Profile read/update beyond the goal-setup flag (profile is returned by login and not edited anywhere).

---

# 2. Detailed Definition for Every Endpoint

## Common conventions

- All request/response bodies are JSON unless marked `multipart/form-data`.
- Field names match the Dart model `toMap()`/`fromMap()` keys **exactly**
  (camelCase): `dailyCalories`, `proteinG`, `carbsG`, `fatG`, `fiberG`,
  `hasCompletedGoalSetup`, `isVerified`, `loggedAt`, `photoUrl`, etc.
- Numbers are JSON numbers (the mobile model reads them via `as num? → toDouble()`,
  so integers and decimals are both accepted).
- Dates/times are ISO-8601 strings (`YYYY-MM-DDTHH:mm:ss`, timezone optional).
- **Authenticated user identity is carried by the JWT** (`custom:user_id`), never by the
  URL path, query string, or request body. User-scoped endpoints therefore have no
  `userId` path parameter. (The mock still keys local `SharedPreferences` by the
  normalized email used as `UserProfile.id` — that is device-local state, not an API
  parameter; see Assumptions.)
- Authentication: endpoints 1–8 are unauthenticated in the mock. Endpoints 11–21 are
  logically per-user and **must** require `Authorization: Bearer <access token>` in the
  real backend. The mock does not send this header (no token exists yet).

### Common error envelope

The mock does **not** define a wire error format (it throws typed Dart exceptions).
The recommended envelope below is therefore **ASSUMED (recommended)** — the mobile
client will need a thin mapping layer to convert these `code`s into the exception
types it already understands:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_CODE",
    "message": "The OTP is invalid or has expired."
  }
}
```

| `error.code` | Mobile mapping (already implemented) | HTTP status |
|---|---|---|
| `INVALID_CODE` | `InvalidCodeException` — "That code doesn't look right. Please try again." | 400 |
| `EXPIRED_CODE` | `ExpiredCodeException` — "This code has expired. Request a new code to continue." | 400 |
| `ACCOUNT_ALREADY_EXISTS` | `AccountAlreadyExistsException` — "This account already exists. Please sign in." | 409 |
| `EMAIL_NOT_VERIFIED` | `EmailNotVerifiedException` — "Please verify your email before signing in." | 403 |
| `INVALID_CREDENTIALS` | generic `AuthException` (message shown as-is) | 401 |
| `VALIDATION_ERROR` | generic `AuthException` (message shown as-is) | 422 |
| `UNAUTHORIZED` | generic error → "Something went wrong…" | 401 |
| `INTERNAL_ERROR` | generic error → "Something went wrong…" | 500 |

---

## 2.1 `POST /auth/register`

**Status:** CONFIRMED (mock) — `AuthService.register(name, email, password)`.

**Purpose:** Create a new account in an *unverified* state and issue a 6-digit email
verification code. Returns the normalized email so the client can start OTP
verification. Does **not** authenticate the caller.

**Authentication:** No.

**Request**

Headers: `Content-Type: application/json`

Body:

```json
{
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "password": "Passw0rd"
}
```

| Field | Type | Req | Description | Validation (from mobile) | Example |
|---|---|---|---|---|---|
| `name` | string | Yes | User's full name | trimmed non-empty | `"Ada Lovelace"` |
| `email` | string | Yes | Email address | regex `^[\w.+-]+@[\w-]+\.[\w.-]+$`, trimmed, lower-cased | `"ada@example.com"` |
| `password` | string | Yes | Account password | ≥ 8 chars, ≥ 1 uppercase, ≥ 1 number | `"Passw0rd"` |

**Success Response** — `201 Created`

```json
{
  "email": "ada@example.com"
}
```

| Field | Type | Nullable | Description |
|---|---|---|---|
| `email` | string | no | Normalized (lower-cased) email of the pending account |

**Error Responses**

| Status | `error.code` | When |
|---|---|---|
| 409 | `ACCOUNT_ALREADY_EXISTS` | A verified account with this email already exists |
| 422 | `VALIDATION_ERROR` | Empty name, invalid email, or password rule violation |

---

## 2.2 `POST /auth/verify-email`

**Status:** CONFIRMED (mock) — `AuthService.verifyEmail(email, code)`.

**Purpose:** Confirm the account by checking the 6-digit code issued by `/auth/register`.

**Authentication:** No.

**Request**

```json
{
  "email": "ada@example.com",
  "code": "482910"
}
```

| Field | Type | Req | Description | Validation |
|---|---|---|---|---|
| `email` | string | Yes | Account email (normalized) | email format |
| `code` | string | Yes | 6-digit numeric OTP | exactly 6 digits (`^\d{6}$`) |

**Success Response** — `200 OK`

```json
{ "success": true }
```

(Field `success`: boolean.)

**Error Responses**

| Status | `error.code` | When |
|---|---|---|
| 400 | `INVALID_CODE` | Code does not match |
| 400 | `EXPIRED_CODE` | Code missing or older than the TTL (mobile mock uses 10 min) |

---

## 2.3 `POST /auth/resend-verification-code`

**Status:** CONFIRMED (mock) — `AuthService.resendVerificationCode(email)`.

**Purpose:** Re-issue a fresh email verification code for an unverified account.

**Authentication:** No.

**Request**

```json
{ "email": "ada@example.com" }
```

| Field | Type | Req | Description |
|---|---|---|---|
| `email` | string | Yes | Account email |

**Success Response** — `200 OK` → `{ "success": true }`

**Error Responses**

| Status | `error.code` | When |
|---|---|---|
| 409 | `ACCOUNT_ALREADY_EXISTS` | Account is already verified (mock throws this) |
| 422 | `VALIDATION_ERROR` | Invalid email |

---

## 2.4 `POST /auth/login`

**Status:** CONFIRMED (mock) — `AuthService.login(email, password)`.

**Purpose:** Authenticate and return the full user profile. The mobile client stores the
returned `UserProfile` and uses `hasCompletedGoalSetup` to decide whether to show
onboarding.

**Authentication:** No (the call itself). It **issues** credentials for later calls.

**Request**

```json
{
  "email": "ada@example.com",
  "password": "Passw0rd"
}
```

| Field | Type | Req | Description | Validation (from mobile) |
|---|---|---|---|---|
| `email` | string | Yes | Account email | email format |
| `password` | string | Yes | Password | ≥ 6 chars on the login form (looser than registration) |

**Success Response** — `200 OK`

```json
{
  "id": "ada@example.com",
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "hasCompletedGoalSetup": false,
  "isVerified": true,
  "accessToken": "<JWT access token>",
  "refreshToken": "<opaque refresh token>"
}
```

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string | no | User identifier (mock = normalized email; recommend UUID) |
| `name` | string | no | Display name |
| `email` | string | no | Normalized email |
| `hasCompletedGoalSetup` | boolean | no | Whether initial onboarding is complete |
| `isVerified` | boolean | no | Whether email is verified |
| `accessToken` | string | no | **ASSUMED (required)** — Bearer token for authenticated calls |
| `refreshToken` | string | no | **ASSUMED (required)** — used by `/auth/refresh` |

> `accessToken`/`refreshToken` are **REQUIRED (missing)** in the mobile mock (it has no
> tokens). The mobile model `UserProfile` does not contain them today; the client will
> need to capture them separately from the response.

**Error Responses**

| Status | `error.code` | When |
|---|---|---|
| 401 | `INVALID_CREDENTIALS` | Wrong email/password |
| 403 | `EMAIL_NOT_VERIFIED` | Account exists but email not verified |

---

## 2.5 `POST /auth/forgot-password`

**Status:** CONFIRMED (mock) — `AuthService.forgotPassword(email)`.

**Purpose:** Start password reset by issuing a 6-digit reset code. **Anti-enumeration:**
always return success for any well-formed email, never reveal account existence.

**Authentication:** No.

**Request**

```json
{ "email": "ada@example.com" }
```

| Field | Type | Req | Description |
|---|---|---|---|
| `email` | string | Yes | Account email |

**Success Response** — `200 OK`

```json
{ "email": "ada@example.com" }
```

**Error Responses** — `422 VALIDATION_ERROR` for malformed email only. Do **not** return
`404`/`409` for unknown emails (anti-enumeration requirement from the mobile flow).

---

## 2.6 `POST /auth/verify-reset-code`

**Status:** CONFIRMED (mock) — `AuthService.verifyForgotPasswordCode(email, code)`.

**Purpose:** Verify the password-reset code. On success the client opens the
new-password screen.

**Authentication:** No.

**Request**

```json
{
  "email": "ada@example.com",
  "code": "731205"
}
```

| Field | Type | Req | Description | Validation |
|---|---|---|---|---|
| `email` | string | Yes | Account email | email format |
| `code` | string | Yes | 6-digit reset code | 6 digits |

**Success Response** — `200 OK` → `{ "success": true }`

**Error Responses**

| Status | `error.code` | When |
|---|---|---|
| 400 | `INVALID_CODE` | Code mismatch |
| 400 | `EXPIRED_CODE` | Code missing/expired |

---

## 2.7 `POST /auth/resend-reset-code`

**Status:** CONFIRMED (mock) — `AuthService.resendForgotPasswordCode(email)`.

**Purpose:** Re-issue a password-reset code.

**Authentication:** No.

**Request** — `{ "email": "ada@example.com" }` (email: string, required).

**Success Response** — `200 OK` → `{ "success": true }`

**Error Responses** — `422 VALIDATION_ERROR` for malformed email.

---

## 2.8 `POST /auth/reset-password`

**Status:** CONFIRMED (mock) — `AuthService.resetPassword(email, newPassword)`.

**Purpose:** Set a new password after the reset code was verified. The mock ties this to
a verified reset session (10-min TTL).

**Authentication:** No (but the backend must require that `/auth/verify-reset-code`
succeeded for this account; see `reset_token` in Assumptions).

**Request**

```json
{
  "email": "ada@example.com",
  "newPassword": "NewPassw0rd"
}
```

| Field | Type | Req | Description | Validation (from mobile) |
|---|---|---|---|---|
| `email` | string | Yes | Account email | email format |
| `newPassword` | string | Yes | New password | ≥ 8 chars, ≥ 1 uppercase, ≥ 1 number |

**Success Response** — `200 OK` → `{ "success": true }`

**Error Responses**

| Status | `error.code` | When |
|---|---|---|
| 400 | `EXPIRED_CODE` | No verified reset session (never verified, or expired) |
| 422 | `VALIDATION_ERROR` | Password rule violation |

---

## 2.9 `POST /auth/refresh` — **REQUIRED (missing)**

**Status:** REQUIRED (missing) — no mobile code exists; the mock has no tokens.

**Purpose:** Exchange a refresh token for a new access token (standard token lifecycle).
Required once real JWT auth is adopted.

**Authentication:** Yes — `refreshToken` in body (or an httpOnly cookie; see Assumptions).

**Request** — `{ "refreshToken": "<opaque token>" }`

**Success Response** — `200 OK`

```json
{
  "accessToken": "<new JWT>",
  "refreshToken": "<rotated refresh token>"
}
```

**Error Responses** — `401 UNAUTHORIZED` when the refresh token is invalid/expired.

---

## 2.10 `POST /auth/logout` — OPTIONAL (client-only today)

**Status:** OPTIONAL — `AuthController.logout()` only clears local state; no server call.

**Purpose:** Revoke the server-side session / refresh token (recommended, not required).

**Authentication:** Yes (Bearer).

**Request** — no body. **Success Response** — `204 No Content`.

---

## 2.11 `PATCH /goal-setup` (completion flag)

**Status:** CONFIRMED (mock) — `AuthService.updateGoalSetup(hasCompletedGoalSetup)`.

**Purpose:** Persist the account-level "has completed initial goal setup" flag so
returning users skip onboarding. Returns the updated profile.

**Authentication:** Yes (Bearer).

**Identity source:** JWT claim `custom:user_id`.

**Request**

Path parameters: none.

```json
{ "hasCompletedGoalSetup": true }
```

| Field | Type | Req | Description |
|---|---|---|---|
| `hasCompletedGoalSetup` | boolean | Yes | New completion state |

**Success Response** — `200 OK` → full `UserProfile` (same shape as login, minus tokens):

```json
{
  "id": "ada@example.com",
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "hasCompletedGoalSetup": true,
  "isVerified": true
}
```

**Error Responses** — `401 UNAUTHORIZED`, `404 NOT_FOUND`.

---

## 2.12 `GET /goal-setup`

**Status:** CONFIRMED (mock) — `GoalSetupService.load()`.

**Purpose:** Load the raw onboarding selections so "Update My Goals" pre-populates the
onboarding form with the user's current values. Returns `null` (404) if never saved.

**Authentication:** Yes (Bearer).

**Identity source:** JWT claim `custom:user_id`.

**Request** — no path parameters, no body.

**Success Response** — `200 OK` → `GoalSetup`:

```json
{
  "goal": "healthier",
  "activity": "light",
  "age": 28,
  "heightCm": 176.0,
  "weightKg": 81.0,
  "imperial": false,
  "mealsPerDay": 4,
  "diet": "balanced"
}
```

Field details → see §5 model `GoalSetup`.

**Error Responses** — `401`, `404` (no goal setup saved yet — client treats as "start fresh").

---

## 2.13 `PUT /goal-setup`

**Status:** CONFIRMED (mock) — `GoalSetupService.save(setup)`.

**Purpose:** Save the raw onboarding selections.

**Authentication:** Yes (Bearer).

**Identity source:** JWT claim `custom:user_id`.

**Request** — no path parameters. Body = `GoalSetup` (same JSON as the GET response above).
All fields optional with the defaults documented in §5.

**Success Response** — `200 OK` → the saved `GoalSetup`.

**Error Responses** — `401`, `422 VALIDATION_ERROR`.

---

## 2.14 `GET /goals`

**Status:** CONFIRMED (mock) — `GoalsService.goals` (read at app start / dashboard).

**Purpose:** Get the user's daily calorie and macro targets.

**Authentication:** Yes (Bearer).

**Request** — no body, no params.

**Success Response** — `200 OK` → `NutritionGoals`:

```json
{
  "dailyCalories": 2155.0,
  "proteinG": 145.0,
  "carbsG": 215.0,
  "fatG": 72.0,
  "fiberG": 30.0
}
```

| Field | Type | Nullable | Description |
|---|---|---|---|
| `dailyCalories` | number | no | Daily calorie target (kcal) |
| `proteinG` | number | no | Daily protein target (g) |
| `carbsG` | number | no | Daily carb target (g) |
| `fatG` | number | no | Daily fat target (g) |
| `fiberG` | number | no | Daily fiber target (g) |

**Error Responses** — `401`.

---

## 2.15 `PUT /goals`

**Status:** CONFIRMED (mock) — `GoalsService.save(goals)` / `NutritionController.updateGoals()`.

**Purpose:** Save the user's daily targets (from onboarding or the Goals screen).

**Authentication:** Yes (Bearer).

**Request** — body = `NutritionGoals` (same JSON as GET). All five fields required
numbers. Ranges enforced by mobile UI (see §8).

**Success Response** — `200 OK` → the saved `NutritionGoals`.

**Error Responses** — `401`, `422 VALIDATION_ERROR`.

---

## 2.16 `POST /meals/analyze` — Meal photo AI analysis

**Status:** CONFIRMED (mock) — `MealAnalysisService.analyzeMeal(MealImageInput)`.
The service doc comment states the intended protocol: *"POST the image bytes
(multipart) to a backend endpoint and deserialize the returned nutrition payload."*

**Purpose:** Analyze a meal photo and return estimated nutrition. The mobile client
expects a **synchronous** response (it shows a loading state and receives the result in
the same call — no job id / polling in the current UI).

**Authentication:** Yes (Bearer).

**Request** — `multipart/form-data`

| Part | Name | Type | Req | Description |
|---|---|---|---|---|
| file | `image` | file (binary) | Yes | Meal photo bytes. Mobile sends the raw bytes it picked (camera/gallery), downscaled by `image_picker` (`maxWidth: 1600`, `imageQuality: 85`) |
| field | `sourceLabel` | string | Yes | Origin of the photo; `"camera"` or `"gallery"` |

> The mobile model `MealImageInput` carries `bytes` + `sourceLabel`. Image is passed as
> binary **bytes** — not base64, not a URL, not an S3 reference.

**Success Response** — `200 OK` → `NutritionAnalysis`:

```json
{
  "mealName": "Chicken Rice Bowl",
  "confidence": 0.94,
  "detectedItems": ["Grilled chicken", "White rice", "Avocado", "Mixed greens"],
  "note": "Balanced meal with good protein and complex carbs.",
  "macros": {
    "proteinG": 45.0,
    "carbsG": 72.0,
    "fatG": 18.0,
    "fiberG": 6.0
  }
}
```

| Field | Type | Nullable | Description |
|---|---|---|---|
| `mealName` | string | no | Suggested meal name (pre-fills the review) |
| `confidence` | number | no | Model confidence `0.0–1.0` |
| `detectedItems` | string[] | no | Detected ingredients |
| `note` | string | no | Optional note/advice (can be `""`) |
| `macros` | `MacroNutrients` | no | Estimated grams. **Calories are NOT returned** — the client derives them from macros (4/4/9) |

**Error Responses**

| Status | `error.code` | When |
|---|---|---|
| 400 | `INVALID_IMAGE` | Missing/unsupported image |
| 413 | `IMAGE_TOO_LARGE` | Image exceeds size limit |
| 422 | `ANALYSIS_FAILED` | AI could not analyze the photo |
| 401 | `UNAUTHORIZED` | Missing/invalid token |

> Mobile UX on any analysis failure: shows a generic "We couldn't analyze this photo.
> Please try again." with a retry button. No error-code parsing is performed here.

---

## 2.17 `GET /meals`

**Status:** CONFIRMED (mock) — `MealRepository.mealsBetween(start, end)` / `mealsOn(day)`.

**Purpose:** List the user's meals. Used by the dashboard, history, and insights.

**Authentication:** Yes (Bearer).

**Request**

Query parameters:

| Name | Type | Req | Description | Allowed |
|---|---|---|---|---|
| `startDate` | string | No | Inclusive lower bound | ISO date `YYYY-MM-DD` |
| `endDate` | string | No | Inclusive upper bound | ISO date `YYYY-MM-DD` |

(If both omitted, return the user's meals in newest-first order. The mobile
`InMemoryMealRepository.meals` sorts by `loggedAt` descending.)

**Success Response** — `200 OK`

```json
{
  "meals": [
    {
      "id": "1725290000000000",
      "name": "Chicken Rice Bowl",
      "type": "lunch",
      "source": "aiAnalysis",
      "loggedAt": "2026-09-02T12:40:00",
      "photoUrl": "https://images.unsplash.com/1547592180-85f173990554?w=640&q=60&auto=format&fit=crop",
      "macros": {
        "proteinG": 45.0,
        "carbsG": 72.0,
        "fatG": 18.0,
        "fiberG": 6.0
      }
    }
  ]
}
```

Meal field details → §5 model `Meal`. (`calories` is derived client-side; the backend
may optionally include it but the client ignores it.)

**Error Responses** — `401`.

---

## 2.18 `GET /meals/{mealId}`

**Status:** CONFIRMED (mock) — `MealRepository.byId(id)`.

**Purpose:** Get a single meal (meal detail / edit screen).

**Authentication:** Yes (Bearer).

**Request** — Path: `mealId` (string, required). No body.

**Success Response** — `200 OK` → single `Meal` object (same shape as above, not wrapped
in `{meals:[…]}`).

**Error Responses** — `401`, `404 NOT_FOUND`.

---

## 2.19 `POST /meals`

**Status:** CONFIRMED (mock) — `MealRepository.add(meal)` / `NutritionController.addMeal()`.

**Purpose:** Log a new meal (manual entry or confirmed AI analysis).

**Authentication:** Yes (Bearer).

**Request**

```json
{
  "name": "Chicken Rice Bowl",
  "type": "lunch",
  "source": "aiAnalysis",
  "loggedAt": "2026-09-02T12:40:00",
  "photoUrl": "https://images.unsplash.com/1547592180-85f173990554?w=640&q=60&auto=format&fit=crop",
  "macros": {
    "proteinG": 45.0,
    "carbsG": 72.0,
    "fatG": 18.0,
    "fiberG": 6.0
  }
}
```

| Field | Type | Req | Description | Validation |
|---|---|---|---|---|
| `id` | string | No | Client generates a timestamp-based id; server **may** generate/override | — |
| `name` | string | Yes | Meal name | trimmed non-empty |
| `type` | string | Yes | `breakfast` \| `lunch` \| `dinner` \| `snack` | enum |
| `source` | string | Yes | `aiAnalysis` \| `manual` | enum |
| `loggedAt` | string | Yes | When the meal was consumed | ISO-8601 date-time |
| `photoUrl` | string | No | Remote photo URL (nullable) | — |
| `macros` | object | Yes | `MacroNutrients` (proteinG, carbsG, fatG, fiberG — numbers ≥ 0) | — |

> **No `calories` field** — the client always derives calories from macros (4/4/9) and
> must not receive a conflicting editable value.
> **No `photoBytes`** — in-memory image bytes are device-local and never uploaded as JSON.

**Success Response** — `201 Created` → the created `Meal` (with server-assigned `id`).

**Error Responses** — `401`, `422 VALIDATION_ERROR`.

---

## 2.20 `PUT /meals/{mealId}`

**Status:** CONFIRMED (mock) — `MealRepository.update(meal)` / `NutritionController.updateMeal()`.

**Purpose:** Update an existing meal (edit screen; also used after AI-review adjustments).

**Authentication:** Yes (Bearer).

**Request** — Path: `mealId`. Body: same shape as `POST /meals` (full replacement of the
mutable fields).

**Success Response** — `200 OK` → the updated `Meal`.

**Error Responses** — `401`, `404 NOT_FOUND`, `422 VALIDATION_ERROR`.

---

## 2.21 `DELETE /meals/{mealId}`

**Status:** CONFIRMED (mock) — `MealRepository.remove(id)` / `NutritionController.deleteMeal()`.

**Purpose:** Delete a meal.

**Authentication:** Yes (Bearer).

**Request** — Path: `mealId`. No body.

**Success Response** — `204 No Content`.

**Error Responses** — `401`, `404 NOT_FOUND`.

---

# 3. Authentication Flow

The mobile app's complete auth flow, expressed as API calls. The current mock
implements the exact same sequence (with in-memory codes instead of email).

### 3.1 Registration + email verification

```
RegisterScreen (Create Account)
        │  name, email, password
        ▼
POST /auth/register ──────────► 201 { email }
        │  (issue 6-digit code, unverified account)
        ▼
OtpVerificationScreen (flow = registration)
        │  email, code
        ▼
POST /auth/verify-email ──────► 200 { success: true }
        │
        ├── resend?  POST /auth/resend-verification-code ──► 200
        │
        ▼
LoginScreen ("Email verified successfully. You can now sign in.")
```

### 3.2 Login

```
LoginScreen (Login)
        │  email, password
        ▼
POST /auth/login ─────────────► 200 { id, name, email, hasCompletedGoalSetup, isVerified,
                                     accessToken, refreshToken }
        │
        ├── hasCompletedGoalSetup == true  ──► AppShell (dashboard)
        └── hasCompletedGoalSetup == false ──► OnboardingScreen
```

### 3.3 Forgot password

```
LoginScreen → "Forgot Password?"
        ▼
ForgotPasswordScreen
        │  email
        ▼
POST /auth/forgot-password ───► 200 { email }   (always succeeds for valid email)
        ▼
OtpVerificationScreen (flow = forgotPassword)
        │  email, code
        ▼
POST /auth/verify-reset-code ─► 200 { success: true }
        │
        ├── resend?  POST /auth/resend-reset-code ──► 200
        │
        ▼
ResetPasswordScreen
        │  email, newPassword
        ▼
POST /auth/reset-password ────► 200 { success: true }
        ▼
LoginScreen ("Password updated successfully. You can now sign in.")
```

### 3.4 Token refresh (required once tokens exist)

```
Authenticated API call ──► 401 UNAUTHORIZED
        ▼
POST /auth/refresh (refreshToken) ──► 200 { accessToken }
        ▼
Retry original call
```

### 3.5 Logout

```
ProfileScreen → Logout ──► client clears local user (no server call in current app)
                           [OPTIONAL] POST /auth/logout
        ▼
LoginScreen
```

### 3.6 Session validation

There is **no** session-restore / `GET /me` call in the current app. Profile state is
held in memory and reconstructed by re-login. A `GET /me` endpoint is
**OPTIONAL** (recommended for app restarts with persisted tokens) — not required today.

**Auth provider note:** The code comments in `auth_service.dart` map each method to AWS
Cognito operations (`signUp`, `confirmSignUp`, `resendConfirmationCode`,
`forgotPassword`, `confirmForgotPassword`). If Cognito is used, the mobile app expects
exactly this semantic mapping; the backend can either wrap Cognito behind these REST
endpoints or the mobile client can call the Cognito SDK directly (neither is implemented
today — the contract above is provider-agnostic).

---

# 4. Business / Data Models

All field names below are the **exact** wire names the mobile client reads/writes.

## 4.1 UserProfile

Fields: `id` (string), `name` (string), `email` (string), `hasCompletedGoalSetup`
(bool, default false), `isVerified` (bool, default true).

Description: lightweight authenticated user. `id` is currently the normalized email;
backend should use a stable UUID (see Assumptions). Related 1:1 to goals, goal-setup, meals.

## 4.2 NutritionGoals

Fields (all numbers): `dailyCalories` (default 2000), `proteinG` (140), `carbsG` (220),
`fatG` (65), `fiberG` (30). Description: daily targets; stored per user (1:1).

## 4.3 GoalSetup

Fields: `goal` (enum `lose|muscle|maintain|healthier`), `activity` (enum
`sedentary|light|active|veryActive`), `age` (int), `heightCm` (number), `weightKg`
(number), `imperial` (bool), `mealsPerDay` (int), `diet` (enum
`none|highProtein|lowCarb|balanced`). Description: raw onboarding inputs; persisted per
user; drives the mobile-side computation of `NutritionGoals`.

## 4.4 MacroNutrients

Fields (numbers, grams): `proteinG`, `carbsG`, `fatG`, `fiberG`. Description: macro
quantities. Calories derived = `protein*4 + carbs*4 + fat*9`.

## 4.5 Meal

Fields: `id` (string), `name` (string), `type` (enum `MealType`), `source` (enum
`MealSource`), `loggedAt` (ISO-8601 string), `photoUrl` (string, nullable),
`macros` (MacroNutrients). Client-only fields (never sent as JSON): `photoBytes`
(in-memory image). Derived (never stored): `calories`. Relationships: N meals → 1 user.

## 4.6 NutritionAnalysis

Fields: `mealName` (string), `confidence` (number 0–1), `detectedItems` (string[]),
`note` (string), `macros` (MacroNutrients). Description: AI meal-analysis result.
Derived (never returned/stored): `calories`.

## 4.7 ReminderSettings — **device-local, no backend model required**

Fields (local only): `mealLoggingEnabled`, `breakfastEnabled`, `breakfastTime`
(`HH:mm`), `lunchEnabled`, `lunchTime`, `dinnerEnabled`, `dinnerTime`,
`hydrationEnabled`, `hydrationFrequency` (`everyHour|everyTwoHours|everyThreeHours|custom`),
`hydrationStart`, `hydrationEnd`, `checkInEnabled`, `checkInTime`.

## 4.8 UnitPreferences — **device-local, no backend model required**

Fields: `energy` (`kcal|kJ`), `weight` (`kg|lb`), `height` (`cm|feetInches`),
`water` (`ml|flOz`).

---

# 5. Meal Photo / AI Analysis API (deep dive)

Current mobile flow:

1. **Pick photo** — device-only via `image_picker` (camera or gallery), downscaled to
   `maxWidth: 1600`, `imageQuality: 85`. No network.
2. **Upload + analyze** — `MealAnalysisService.analyzeMeal(MealImageInput(bytes, sourceLabel))`.
   Intended protocol (from the service doc comment): **multipart POST** with the image
   bytes. The mobile client expects a **synchronous** result — it awaits a single call
   and renders a loading state ("Analyzing your meal…").
3. **Result** — `NutritionAnalysis` is returned and shown for review (meal name,
   confidence, detected items, note, macros).
4. **Review / adjust** — the user may edit protein/carbs/fat (fiber is carried from the
   analysis); calories recompute automatically (4/4/9).
5. **Confirm** — the reviewed meal is saved via `POST /meals` (not a separate
   "confirm analysis" call).

### Explicit answers

| Question | Answer |
|---|---|
| Multipart upload? | **Yes** (image bytes as a file part) |
| Base64 image? | No |
| Image URL? | No (client sends bytes; it never uploads to get a URL first) |
| S3 object reference? | Not required by current app |
| Asynchronous processing? | No — **synchronous** |
| Analysis/job ID? | No |
| Polling endpoint? | No |
| WebSocket/push? | No |

If the backend needs asynchronous AI (recommended for long inference), the sync contract
above must still be preserved behind a facade that waits for completion; the current
mobile UI cannot handle a job/poll flow without client changes.

---

# 6. Nutrition and Macro Calculations

### 6.1 The one hard rule

**Calories for a *meal* are always derived from macros: `protein×4 + carbs×4 + fat×9`.**
The mobile UI has no field for meal calories, and it must remain that way on the wire
(`POST/PUT /meals` and `/meals/analyze` responses contain macros only).

### 6.2 Where each value is computed

| Value | Computed by | Notes |
|---|---|---|
| Meal calories | **Mobile** (`MacroNutrients.calories`, `NutritionUtils.caloriesFromMacros`) | Never sent/stored |
| AI meal macros | **Backend / AI service** | `/meals/analyze` returns grams |
| Goal daily calories (onboarding) | **Mobile** | Derived from macros after computing BMR/TDEE (see below) |
| Goal daily calories (Goals screen) | **User-editable → stored** | The Goals screen lets the user set `dailyCalories` directly (800–5000) |
| Goal macro targets | **Mobile (onboarding) / user-editable (Goals screen)** | Stored via `/goals` |
| Daily consumed calories/macros | **Mobile** | Summed in `NutritionController` from `/meals` data |
| Insights/statistics | **Mobile** | Derived from `/meals` data — no backend stats endpoint |

### 6.3 Onboarding goal derivation (mobile-side, for reference)

The onboarding screen computes targets locally:
- BMR (Mifflin-St Jeor): `10·weightKg + 6.25·heightCm − 5·age`
- TDEE: `BMR × activity multiplier`
- Estimated calories: `TDEE × goal factor`
- Protein/carbs grams: `est × dietPct ÷ 4`, rounded to 5 g; fat: `est × fatPct ÷ 9`
- `dailyCalories` = derived **from the final macros** (4/4/9); `fiberG` = 30.

The backend does **not** need to implement this — the client computes and uploads the
result via `PUT /goals`. (If product wants server-computed goals later, this is the
formula to replicate.)

---

# 7. Data Validation (as enforced by the mobile client)

| Field | Rule | Source |
|---|---|---|
| `email` | regex `^[\w.+-]+@[\w-]+\.[\w.-]+$`, trimmed, lower-cased | login/register/forgot forms |
| `name` (register) | trimmed non-empty | RegisterScreen |
| `password` (register/reset) | ≥ 8 chars, ≥ 1 uppercase, ≥ 1 number | RegisterScreen / ResetPasswordScreen |
| `password` (login) | ≥ 6 chars | LoginScreen |
| `code` (OTP) | exactly 6 digits; UI requires `length == 6` before submit | OtpVerificationScreen |
| `mealName` / `name` | trimmed non-empty | ManualLogScreen / AI review |
| `type` | enum `breakfast|lunch|dinner|snack` | MealType |
| `source` | enum `aiAnalysis|manual` | MealSource |
| Macro inputs (meal) | protein 0–300 (step 5), carbs 0–400 (step 5), fat 0–200 (step 5), fiber 0–… (step 1) | ManualLogScreen / AiAnalysisScreen `NutritionInput` |
| Goals | calories 800–5000 (step 50), protein 0–300, carbs 0–500, fat 0–150, fiber 0–60 | GoalsScreen |
| `loggedAt` | date-time; picker bounds −365d … +1d | ManualLogScreen |
| Image | JPEG/PNG from camera/gallery; client downscales to 1600px / quality 85 | `image_picker` |

The backend should enforce at least the same rules (server-side) and return
`422 VALIDATION_ERROR` with a human-readable message on failure.

---

# 8. API Dependencies and Flow (Screen → Action → API → Response → Next)

| Screen | User action | API | Request | Response | Next screen/action |
|---|---|---|---|---|---|
| Login | Tap **Login** | POST `/auth/login` | email, password | UserProfile (+tokens) | AppShell or Onboarding |
| Login | Tap **Create Account** | — | — | — | RegisterScreen |
| Login | Tap **Forgot Password?** | — | — | — | ForgotPasswordScreen |
| Register | Tap **Create Account** | POST `/auth/register` | name, email, password | `{ email }` | OtpVerificationScreen (registration) |
| OTP (reg) | Enter code / **Verify** | POST `/auth/verify-email` | email, code | `{ success }` | LoginScreen (verified banner) |
| OTP | **Resend code** | POST `/auth/resend-verification-code` | email | `{ success }` | cooldown, stay on OTP |
| Forgot | **Send code** | POST `/auth/forgot-password` | email | `{ email }` | OtpVerificationScreen (forgot) |
| OTP (forgot) | **Verify code** | POST `/auth/verify-reset-code` | email, code | `{ success }` | ResetPasswordScreen |
| OTP (forgot) | **Resend** | POST `/auth/resend-reset-code` | email | `{ success }` | cooldown |
| Reset | **Reset password** | POST `/auth/reset-password` | email, newPassword | `{ success }` | LoginScreen (banner) |
| Onboarding | **Finish** | PUT `/goals`; PUT `/goal-setup`; PATCH `/goal-setup` | NutritionGoals; GoalSetup; `{hasCompletedGoalSetup:true}` | goals; setup; UserProfile | AppShell |
| App shell (post-login) | (auto-load) | GET `/goals`; GET `/meals` | — | goals; meals | Dashboard renders |
| App shell | **Scan Meal** | — | — | — | AiAnalysisScreen |
| AiAnalysis | pick photo (device) | — | local bytes | — | preview |
| AiAnalysis | **Analyze Meal** | POST `/meals/analyze` | multipart `image` + `sourceLabel` | NutritionAnalysis | review screen |
| AiAnalysis | **Add meal** | POST `/meals` | name, type=`aiAnalysis`, macros, loggedAt | Meal | pop → home (success toast) |
| App shell | **Log Manually** | — | — | — | ManualLogScreen |
| ManualLog | **Save** | POST `/meals` | name, type, macros, loggedAt | Meal | pop → home |
| Meal detail | **Edit** | (loads meal) GET `/meals/{id}` | — | Meal | ManualLogScreen (edit mode) |
| Meal detail (edit) | **Save** | PUT `/meals/{id}` | updated meal | Meal | pop |
| Meal detail | **Delete** | DELETE `/meals/{id}` | — | 204 | pop |
| History | view/open | GET `/meals?startDate&endDate` | date range | meals[] | list/filters |
| Insights | view | GET `/meals` (then client computes) | — | meals[] | charts |
| Goals | **Save Goals** | PUT `/goals` | NutritionGoals | goals | pop |
| Profile | **Update My Goals** | GET `/goal-setup` | — | GoalSetup | Onboarding (pre-filled) |
| Profile | **Logout** | (client-only) [optional POST `/auth/logout`] | — | — | LoginScreen |

---

# 9. OpenAPI Specification

See the companion file `openapi.yaml` (OpenAPI 3.0.3, JSON/YAML-compatible) containing
all 21 endpoints with schemas, parameters, request bodies, responses, and security
schemes. Copy it directly into Swagger/OpenAPI tooling.

---

# 10. Backend Implementation Checklist

### Authentication APIs
- [ ] POST `/auth/register`
- [ ] POST `/auth/verify-email`
- [ ] POST `/auth/resend-verification-code`
- [ ] POST `/auth/login`
- [ ] POST `/auth/forgot-password`
- [ ] POST `/auth/verify-reset-code`
- [ ] POST `/auth/resend-reset-code`
- [ ] POST `/auth/reset-password`
- [ ] POST `/auth/refresh` *(token lifecycle — required once JWT adopted)*
- [ ] POST `/auth/logout` *(optional)*

### User APIs
- [ ] PATCH `/goal-setup`
- [ ] GET `/goal-setup`
- [ ] PUT `/goal-setup`

### Nutrition / Goals APIs
- [ ] GET `/goals`
- [ ] PUT `/goals`

### Meal Analysis APIs
- [ ] POST `/meals/analyze` (multipart)

### Meal APIs
- [ ] GET `/meals`
- [ ] GET `/meals/{mealId}`
- [ ] POST `/meals`
- [ ] PUT `/meals/{mealId}`
- [ ] DELETE `/meals/{mealId}`

### Critical Missing APIs
- `POST /auth/refresh` — the flow requires a token lifecycle once auth is real; there is
  no mobile code for it today.
- Token issuance fields (`accessToken`, `refreshToken`) on `/auth/login` — required by the
  auth flow but absent from the current `UserProfile` model.

### Unclear Contracts (cannot be determined from mobile code)
- Exact wire error format — the mobile client currently throws typed Dart exceptions;
  the JSON error envelope in this document is a **recommendation**, not a confirmed
  contract. The `code`↔exception mapping table in §Common conventions must be finalized
  with the mobile team.
- Identity mapping — the mock keys local storage by the normalized email (a device-local
  simulation); the real backend must derive identity from the JWT `custom:user_id` claim
  and may expose a stable UUID in the profile (requires a small client change).
- `/auth/reset-password` server-side binding — the mock ties the reset to a
  10-min in-memory session; the backend must choose a mechanism (e.g., a `reset_token`
  returned by `/auth/verify-reset-code`).
- Token storage/transport (Authorization header vs. httpOnly cookie) — not defined in
  the mobile app.

### Assumptions (not facts from code)
- Base URL `https://api.biteiq.example.com/v1` is a placeholder.
- Bearer JWT in `Authorization` header for authenticated endpoints.
- REST JSON over HTTP (the mock has no transport; REST is inferred from the doc comments
  in `meal_analysis_service.dart`).
- Server-generated meal `id` (the mock client-generates a timestamp id).
- ISO-8601 date-time strings for `loggedAt`.

### Facts (confirmed from code)
- All endpoint request/response **field names** and **models** in this document.
- All validation rules in §7.
- The synchronous, multipart, macros-only meal analysis contract.
- The 4/4/9 calorie derivation rule and the fact that meal calories are never
  user-editable.
- Reminders, units, and theme are device-local with **no** backend requirement.
