import sqlite3
import json
import os

DB_PATH = r'C:\Users\Sergey\.local\share\mimocode\mimocode.db'
PROJECT_DIR = r'E:\streamlume-tv'

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

# List tables
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [row[0] for row in cursor.fetchall()]
print("=== TABLES ===")
print(tables)

# Get schema for key tables
for t in tables:
    cursor.execute(f"PRAGMA table_info({t})")
    cols = [(row['name'], row['type']) for row in cursor.fetchall()]
    print(f"\n--- {t} schema ---")
    print(cols)

# List sessions, newest first
print("\n=== SESSIONS (newest first) ===")
cursor.execute("SELECT * FROM session ORDER BY time_created DESC LIMIT 20")
for row in cursor.fetchall():
    print(dict(row))

# Check for project-specific sessions
print("\n=== ALL SESSIONS ===")
cursor.execute("SELECT id, title, time_created, data FROM session ORDER BY time_created DESC")
for row in cursor.fetchall():
    d = json.loads(row[3]) if row[3] else {}
    print(f"  {row[0]} | title={row[1]} | time={row[2]} | data_keys={list(d.keys()) if isinstance(d, dict) else 'N/A'}")

conn.close()
