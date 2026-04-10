import sqlite3
con = sqlite3.connect('backend/data/catalogs.sqlite3')
rows = con.execute("SELECT name, star_id, mag FROM stars WHERE catalog='tycho2' AND name != star_id LIMIT 30").fetchall()
for r in rows:
    print(r)
count = con.execute("SELECT COUNT(*) FROM stars WHERE catalog='tycho2' AND name != star_id").fetchone()[0]
total = con.execute("SELECT COUNT(*) FROM stars WHERE catalog='tycho2'").fetchone()[0]
print(f'\nTotal with distinct name: {count} / {total}')
