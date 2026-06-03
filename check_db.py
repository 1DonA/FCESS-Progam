import sqlite3

def check():
    conn = sqlite3.connect('fcess.db')
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cursor.fetchall()
    print("Tables:", tables)
    conn.close()

if __name__ == "__main__":
    check()
