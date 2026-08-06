import sqlite3
import json

DB_PATH = r'C:\Users\Sergey\.local\share\mimocode\mimocode.db'

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

# Get last assistant message from the Приветствие session
sid = 'ses_07c2bf238ffegNgo5vgssgsc3b'
cursor.execute("""
    SELECT m.id, json_extract(m.data, '$.role') as role, m.time_created
    FROM message m
    WHERE m.session_id = ? AND json_extract(m.data, '$.role') = 'assistant'
    ORDER BY m.time_created DESC
    LIMIT 1
""", (sid,))
last_msg = cursor.fetchone()
print(f"Last assistant message: {last_msg['id']} at {last_msg['time_created']}")

cursor.execute("""
    SELECT id, json_extract(data, '$.type') as pt, data
    FROM part
    WHERE message_id = ?
    ORDER BY time_created
""", (last_msg['id'],))
parts = cursor.fetchall()
for p in parts:
    pdata = json.loads(p['data'])
    pt = pdata.get('type')
    if pt == 'text':
        text = pdata.get('text', '')
        print(f"\n[TEXT]\n{text}")
    elif pt == 'step-finish':
        print(f"\n[step-finish] tokens={pdata.get('tokens', {})}")
    else:
        print(f"\n[{pt}] keys={list(pdata.keys())}")

# Also search user messages for any rules/decisions
print("\n\n=== ALL USER MESSAGES ===")
cursor.execute("""
    SELECT m.id, m.time_created, json_extract(m.data, '$.role') as role
    FROM message m
    WHERE m.session_id = ?
    ORDER BY m.time_created
""", (sid,))
for msg in cursor.fetchall():
    cursor.execute("""
        SELECT json_extract(data, '$.type') as pt, data
        FROM part WHERE message_id = ?
        ORDER BY time_created
    """, (msg['id'],))
    for p in cursor.fetchall():
        pdata = json.loads(p['data'])
        if pdata.get('type') == 'text':
            text = pdata.get('text', '')
            # Only print first 500 chars
            if len(text) > 500:
                text = text[:500] + f"... [{len(text)} chars total]"
            print(f"\n[{msg['time_created']}] {text}")

# Also get the global session for reference
print("\n\n=== GLOBAL SESSION ===")
cursor.execute("""
    SELECT s.id, s.title, s.project_id, s.directory, s.time_created
    FROM session s WHERE s.project_id = 'global'
""")
for s in cursor.fetchall():
    print(dict(s))

conn.close()
