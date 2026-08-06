import sqlite3
import json

DB_PATH = r'C:\Users\Sergey\.local\share\mimocode\mimocode.db'

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

# Get sessions for this project
PROJECT_ID = '0113941f-05f4-4da5-9558-a32bc5c6e343'
cursor.execute("SELECT id, title, directory, time_created, time_updated FROM session WHERE project_id = ? ORDER BY time_created DESC", (PROJECT_ID,))
sessions = cursor.fetchall()
print("=== PROJECT SESSIONS ===")
for s in sessions:
    print(f"  {s['id']} | {s['title']} | dir={s['directory']} | created={s['time_created']} | updated={s['time_updated']}")

# For each session, get all messages with parts
for s in sessions:
    sid = s['id']
    print(f"\n{'='*60}")
    print(f"SESSION: {sid} - {s['title']}")
    print(f"{'='*60}")
    
    cursor.execute("""
        SELECT m.id as msg_id, m.agent_id, m.time_created, json_extract(m.data, '$.role') as role
        FROM message m
        WHERE m.session_id = ?
        ORDER BY m.time_created
    """, (sid,))
    messages = cursor.fetchall()
    
    for msg in messages:
        role = msg['role']
        agent_id = msg['agent_id'] or 'main'
        print(f"\n--- [{role}] agent={agent_id} time={msg['time_created']} msg={msg['msg_id']} ---")
        
        cursor.execute("""
            SELECT id, json_extract(data, '$.type') as part_type, 
                   json_extract(data, '$.tool') as tool,
                   data
            FROM part
            WHERE message_id = ?
            ORDER BY time_created
        """, (msg['msg_id'],))
        parts = cursor.fetchall()
        
        for p in parts:
            pt = p['part_type']
            if pt == 'text':
                # Extract text
                pdata = json.loads(p['data'])
                text = pdata.get('text', '')
                # Truncate long text
                if len(text) > 500:
                    text = text[:500] + f"... [truncated, {len(text)} chars total]"
                print(f"  [text] {text}")
            elif pt == 'tool':
                pdata = json.loads(p['data'])
                tool = pdata.get('tool', 'unknown')
                state = pdata.get('state', {})
                inp = state.get('input', {})
                out = state.get('output', '')
                if isinstance(out, str) and len(out) > 300:
                    out = out[:300] + f"... [truncated, {len(out)} chars total]"
                print(f"  [tool:{tool}] input_preview={json.dumps(inp, ensure_ascii=False)[:200]}")
                if out:
                    print(f"    output: {out}")
            elif pt == 'step-start':
                print(f"  [step-start]")
            elif pt == 'step-finish':
                pdata = json.loads(p['data'])
                tokens = pdata.get('tokens', {})
                print(f"  [step-finish] tokens={tokens}")
            else:
                print(f"  [{pt}]")

# Also check tasks
print(f"\n{'='*60}")
print("TASKS")
print(f"{'='*60}")
cursor.execute("SELECT * FROM task WHERE session_id IN (SELECT id FROM session WHERE project_id = ?)", (PROJECT_ID,))
for t in cursor.fetchall():
    print(dict(t))

# Check task events
print(f"\nTASK EVENTS")
cursor.execute("""
    SELECT te.* FROM task_event te 
    JOIN task t ON te.task_id = t.id 
    WHERE t.session_id IN (SELECT id FROM session WHERE project_id = ?)
    ORDER BY te.at
""", (PROJECT_ID,))
for te in cursor.fetchall():
    print(dict(te))

# Check actor_registry
print(f"\nACTOR REGISTRY")
cursor.execute("""
    SELECT ar.* FROM actor_registry ar 
    WHERE ar.session_id IN (SELECT id FROM session WHERE project_id = ?)
""", (PROJECT_ID,))
for ar in cursor.fetchall():
    print(dict(ar))

conn.close()
