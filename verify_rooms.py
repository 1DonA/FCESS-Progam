import requests
import json
import sys

BASE_URL = "http://localhost:8000/api/v1"

def verify_rooms():
    # 1. Login
    print("Logging in...")
    resp = requests.post(f"{BASE_URL}/auth/login", data={"username": "admin@example.com", "password": "password123"})
    if resp.status_code != 200:
        print(f"Login failed: {resp.text}")
        return
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Create Building
    print("Creating Building...")
    bpa = {"name": "Engineering Hall", "code": "ENG"}
    resp = requests.post(f"{BASE_URL}/catalog/buildings", json=bpa, headers=headers)
    if resp.status_code != 200:
        print(f"Create Building failed: {resp.text}")
        return
    bldg_id = resp.json()["id"]
    print(f"Building created: {bldg_id}")

    # 3. Create Room
    print("Creating Room...")
    rpa = {"room_number": "101", "building_id": bldg_id, "capacity": 50, "type": "LECTURE_HALL"}
    resp = requests.post(f"{BASE_URL}/catalog/rooms", json=rpa, headers=headers)
    if resp.status_code != 200:
        print(f"Create Room failed: {resp.text}")
        return
    print(f"Room created: {resp.json()['id']}")

    # 4. List Rooms
    print("Listing Rooms...")
    resp = requests.get(f"{BASE_URL}/catalog/rooms", headers=headers)
    rooms = resp.json()
    print(f"Found {len(rooms)} rooms.")
    for r in rooms:
        print(f" - {r['room_number']} ({r['type']}) in {r['building']['code']}")

if __name__ == "__main__":
    verify_rooms()
