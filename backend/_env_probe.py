import re,pathlib
for line in pathlib.Path(".env").read_text(encoding="utf-8", errors="ignore").splitlines():
    line=line.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    k,v=line.split("=",1); v=v.strip().strip('"').strip("'")
    print(k, "=", (v[:6]+"***"+v[-4:]) if len(v)>12 else ("(空)" if not v else v))
