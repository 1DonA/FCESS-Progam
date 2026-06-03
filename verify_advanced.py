import requests
import json
import sys

BASE_URL = "http://localhost:8000/api/v1"

def verify_advanced_schedule():
    # 1. Login
    print("Logging in...")
    resp = requests.post(f"{BASE_URL}/auth/login", data={"username": "admin@example.com", "password": "password123"})
    if resp.status_code != 200:
        print(f"Login failed: {resp.text}")
        return
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Trigger Schedule
    # Need Semester ID. from seed: '91f3f6a3b9ec469f911a20b0e41f831b'
    SEM_ID = "0885869f-e170-4f8b-ac65-c0c99646cc69"
    print(f"Triggering schedule for {SEM_ID}...")
    resp = requests.post(f"{BASE_URL}/scheduling/generate/{SEM_ID}", headers=headers)
    if resp.status_code != 200:
        print(f"Scheduling failed: {resp.text}")
        return
    print(f"Schedule Result: {resp.json()}")

    # 3. View Schedule and Verify
    print("Fetching sessions...")
    resp = requests.get(f"{BASE_URL}/scheduling/view/{SEM_ID}", headers=headers)
    if resp.status_code != 200:
        print(f"Fetch failed: {resp.text}")
        return
    
    sessions = resp.json()
    print(f"Got {len(sessions)} sessions.")
    
    violations = 0
    for s in sessions:
        # Check Faculty
        if s["faculty"] == "Unassigned" or not s["faculty"]:
            print(f"VIOLATION: Session {s['id']} has no faculty!")
            violations += 1
        else:
            print(f" - Session {s['courseCode']}: Faculty={s['faculty']}, Room={s['room']}")
            
        # Check Room (We know seed rooms are 101/SC and 101/ENG ?? Wait, seed data recreated...)
        # Seed Data info:
        # Created Room: 101 (LECTURE_HALL) in SC, Cap 50? No, seed data has NO rooms! 
        # WAIT. `seed_data.py` does NOT creating Rooms!
        # The `verify_rooms.py` created rooms via API.
        # But I reset the DB.
        # So currently DB has NO ROOMS.
        # Scheduling should FAIL (0 success).
    
    if len(sessions) == 0:
        print("No sessions generated (Expected if no rooms).")
        
        # 4. Create Rooms if needed
        print("Creating resources for re-test...")
        # Create Building
        b_resp = requests.post(f"{BASE_URL}/catalog/buildings", json={"name": "Engineering", "code": "ENG"}, headers=headers)
        b_id = b_resp.json()["id"]
        # Create Room (Cap 40 > 30)
        requests.post(f"{BASE_URL}/catalog/rooms", json={"room_number": "101", "building_id": b_id, "capacity": 40, "type": "LECTURE_HALL"}, headers=headers)
        # Create Room (Cap 20 < 30) - Should NOT be used
        requests.post(f"{BASE_URL}/catalog/rooms", json={"room_number": "Tiny", "building_id": b_id, "capacity": 20, "type": "LECTURE_HALL"}, headers=headers)
        
        print("Resources created. Retrying schedule...")
        resp = requests.post(f"{BASE_URL}/scheduling/generate/{SEM_ID}", headers=headers)
        print(f"Retry Result: {resp.json()}")
        
        resp = requests.get(f"{BASE_URL}/scheduling/view/{SEM_ID}", headers=headers)
        sessions = resp.json()
        
        for s in sessions:
             print(f" - {s['courseCode']}: {s['faculty']} in {s['room']}")
             if s['room'] == "Tiny":
                 print("VIOLATION: Used Tiny room (cap 20) for section (enroll 30)!")
                 violations += 1
             if s['faculty'] == "Unassigned":
                 print("VIOLATION: No Faculty!")
                 violations += 1

    if violations == 0:
        print("SUCCESS: Strategies verified.")
    else:
        print(f"FAILURE: {violations} violations found.")

if __name__ == "__main__":
    verify_advanced_schedule()
