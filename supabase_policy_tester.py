#!/usr/bin/env python3
"""
Supabase RLS Policy Tester (REST-level)
"""

import argparse
import json
import sys
import time
from typing import Optional

import requests


def h1(msg): print("\n" + "="*len(msg) + f"\n{msg}\n" + "="*len(msg))
def ok(msg): print(f"  ✅ {msg}")
def bad(msg): print(f"  ❌ {msg}")
def info(msg): print(f"  • {msg}")


def validate_jwt(token: Optional[str]) -> bool:
    if not token or token.count(".") != 2:
        bad("The --token you provided is not a valid JWT (must have 3 dot-separated parts).")
        return False
    return True


class Supa:
    def __init__(self, url: str, anon_key: str, token: Optional[str]=None):
        self.url = url.rstrip("/")
        self.anon = anon_key
        self.token = token

    def _headers(self, wants_json=True):
        h = {"apikey": self.anon}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        if wants_json:
            h["Content-Type"] = "application/json"
        return h

    def rest_get(self, table: str, params: str):
        u = f"{self.url}/rest/v1/{table}{params}"
        return requests.get(u, headers=self._headers(False))

    def rest_post(self, table: str, data: dict, prefer: Optional[str]=None):
        u = f"{self.url}/rest/v1/{table}"
        headers = self._headers()
        if prefer:
            headers["Prefer"] = prefer
        return requests.post(u, headers=headers, data=json.dumps(data))

    def rest_patch(self, table: str, params: str, data: dict):
        u = f"{self.url}/rest/v1/{table}{params}"
        return requests.patch(u, headers=self._headers(), data=json.dumps(data))

    # Storage tests (optional)
    def storage_list(self, bucket: str, prefix: str=""):
        u = f"{self.url}/storage/v1/object/list/{bucket}"
        payload = {"prefix": prefix}
        return requests.post(u, headers=self._headers(), data=json.dumps(payload))


def test_users_visibility(s: Supa):
    h1("users table — visibility & write protection")

    # anonymous read (if you allow public profile reading)
    anon = Supa(s.url, s.anon, token=None)
    r = anon.rest_get("users", "?select=id,username,visibility&limit=3")
    if r.status_code == 200:
        ok("Anon can SELECT limited profile fields (expected only if you allow it).")
        info(f"Sample rows: {r.json()}")
    elif r.status_code in (401,403):
        ok("Anon is blocked from SELECT on users (good if profiles are private).")
    else:
        bad(f"Unexpected anon users SELECT: {r.status_code} {r.text[:180]}")

    # authenticated read
    r = s.rest_get("users", "?select=id,username,visibility&limit=3")
    if r.status_code == 200:
        ok("Authenticated can SELECT users (common).")
    else:
        bad(f"Authenticated users SELECT failed: {r.status_code} {r.text[:180]}")

    # try to patch someone else (should be blocked)
    r_forbidden = s.rest_patch("users", "?id=eq.11111111-2222-3333-4444-555555555555", {"bio": "hack"})
    if r_forbidden.status_code in (401,403):
        ok("UPDATE (PATCH) another user's profile is blocked (expected).")
    else:
        bad(f"UPDATE another user's profile unexpectedly allowed: {r_forbidden.status_code} {r_forbidden.text[:180]}")

    # sanity: patch nothing on self should either 204 or 200 if allowed (won't change data)
    r_self = s.rest_patch("users", "?id=eq.DUMMY-SELF-ID-WILL-BE-OVERRIDDEN", {"bio": "noop"})
    info(f"(Note) Self-update test uses your RLS; ignore if blocked by your policy: {r_self.status_code}")


def test_posts_rls(s: Supa, my_id: str, other_id: Optional[str]):
    h1("posts table — RLS for SELECT/INSERT/UPDATE/DELETE")

    r = s.rest_get("posts", "?select=id,author_id,content,created_at&order=created_at.desc&limit=5")
    if r.status_code == 200:
        rows = r.json()
        ok(f"SELECT posts ok: {len(rows)} row(s).")
        if rows:
            mine = all(row.get("author_id") == my_id for row in rows)
            if mine:
                ok("All returned posts belong to current user (strict policy).")
            else:
                bad("Returned posts include other users — policy may be too open.")
    else:
        bad(f"SELECT posts failed: {r.status_code} {r.text[:180]}")

    if other_id:
        r = s.rest_post("posts",
                        {"author_id": other_id, "content": "policy test: should be blocked"},
                        prefer="return=representation")
        if r.status_code in (401,403):
            ok("INSERT post as someone else is blocked (expected).")
        else:
            bad(f"INSERT other user's post unexpectedly succeeded: {r.status_code} {r.text[:180]}")

    r = s.rest_post("posts",
                    {"author_id": my_id, "content": f"policy test ok at {int(time.time())}"},
                    prefer="return=representation")
    if r.status_code in (200,201):
        ok("INSERT post as myself succeeded.")
        try:
            post = r.json()[0] if isinstance(r.json(), list) and r.json() else r.json()
            _ = post.get("id")
        except Exception:
            pass
    else:
        bad(f"INSERT post as myself failed: {r.status_code} {r.text[:180]}")

    if other_id:
        r_list = s.rest_get("posts", f"?select=id,author_id&author_id=eq.{other_id}&limit=1")
        if r_list.status_code == 200 and r_list.json():
            pid = r_list.json()[0]["id"]
            r_up = s.rest_patch("posts", f"?id=eq.{pid}", {"content": "hack attempt"})
            if r_up.status_code in (401,403):
                ok("UPDATE on someone else's post is blocked (expected).")
            else:
                bad(f"UPDATE on someone else's post unexpectedly allowed: {r_up.status_code} {r_up.text[:180]}")
        else:
            info("No other user's post found to test UPDATE (skipping).")


def test_locations_rls(s: Supa, my_id: str, other_id: Optional[str]):
    h1("locations table — RLS for SELECT / UPSERT / cross-user block")

    r = s.rest_get("locations", "?select=id,lat,lng,updated_at&order=updated_at.desc")
    if r.status_code == 200:
        rows = r.json()
        ok(f"SELECT locations ok: {len(rows)} row(s).")
        if rows and not all(row.get("id") == my_id for row in rows):
            bad("Locations include other users — check your SELECT policy.")
    else:
        bad(f"SELECT locations failed: {r.status_code} {r.text[:180]}")

    r = s.rest_post("locations",
                    {"id": my_id, "lat": -36.85, "lng": 174.76},
                    prefer="resolution=merge-duplicates,return=representation")
    if r.status_code in (200,201):
        ok("Upsert my location succeeded.")
    else:
        bad(f"Upsert my location failed: {r.status_code} {r.text[:180]}")

    if other_id:
        r = s.rest_post("locations",
                        {"id": other_id, "lat": 0, "lng": 0},
                        prefer="resolution=merge-duplicates,return=representation")
        if r.status_code in (401,403):
            ok("Upsert other user's location is blocked (expected).")
        else:
            bad(f"Upsert other user's location unexpectedly succeeded: {r.status_code} {r.text[:180]}")


def test_storage(s: Supa, bucket: str, my_id: str):
    h1(f"storage bucket: {bucket} — listing (privacy expectation)")

    anon = Supa(s.url, s.anon, token=None)
    r = anon.storage_list(bucket, prefix=my_id)
    if r.status_code == 200:
        ok("Anon can list objects — bucket is public.")
        info(f"Objects sample: {r.json()[:3]}")
    elif r.status_code in (401,403):
        ok("Anon is blocked — bucket likely private (good for privacy).")
    else:
        bad(f"Unexpected storage list status: {r.status_code} {r.text[:180]}")

    r = s.storage_list(bucket, prefix=my_id)
    if r.status_code == 200:
        ok("Authenticated can list own prefix (expected).")
    else:
        bad(f"Authenticated storage list failed: {r.status_code} {r.text[:180]}")


def main():
    ap = argparse.ArgumentParser(description="Supabase RLS policy tester (REST-level).")
    ap.add_argument("--url", required=True, help="Project URL, e.g. https://XYZ.supabase.co")
    ap.add_argument("--anon", required=True, help="Anon (publishable) key")
    ap.add_argument("--token", required=True, help="Authenticated user's access_token (JWT)")
    ap.add_argument("--user-id", required=True, help="Authenticated user's UUID")
    ap.add_argument("--other-user-id", default=None, help="Another user's UUID to test cross-user blocking")
    ap.add_argument("--storage-bucket", default=None, help="Bucket to test (e.g. profile-pics)")
    args = ap.parse_args()

    if not validate_jwt(args.token):
        sys.exit(2)

    s = Supa(args.url, args.anon, args.token)

    h1("Smoke: profile lookup for current user")
    r = s.rest_get("users", f"?select=id,username,visibility&id=eq.{args.user_id}")
    if r.status_code == 200:
        rows = r.json()
        if rows:
            ok(f"Found profile for {args.user_id}: {rows[0]}")
        else:
            bad(f"No users row for {args.user_id} (you may rely only on auth metadata).")
    else:
        bad(f"Profile lookup failed: {r.status_code} {r.text[:180]}")

    test_users_visibility(s)
    test_posts_rls(s, args.user_id, args.other_user_id)
    test_locations_rls(s, args.user_id, args.other_user_id)

    if args.storage_bucket:
        test_storage(s, args.storage_bucket, args.user_id)

    h1("Done")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
