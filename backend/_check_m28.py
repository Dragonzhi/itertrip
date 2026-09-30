"""Static PWA serving contract, using TestClient only (no live browser/network)."""
import json
from fastapi.testclient import TestClient
from .main import app, _DIST
from .engine.schema import TransportSnapshot


def main():
    assert (_DIST / "sw.js").is_file(), "Build frontend first"
    assert TransportSnapshot(signature="test", options=[], refresh_error="网络中断").model_dump()["refresh_error"] == "网络中断"
    with TestClient(app) as client:
        for prefix in ("/", "/itertrip/"):
            shell = client.get(prefix)
            assert shell.status_code == 200 and "rel=\"manifest\"" in shell.text
            assert shell.headers.get("cache-control") == "no-cache"
            sw = client.get(prefix + "sw.js")
            assert sw.status_code == 200 and "javascript" in sw.headers["content-type"]
            assert sw.headers["cache-control"] == "no-cache"
            manifest = client.get(prefix + "manifest.webmanifest")
            assert manifest.status_code == 200 and manifest.headers["content-type"].startswith("application/manifest+json")
            for icon in json.loads(manifest.text)["icons"]:
                res = client.get(prefix + icon["src"])
                assert res.status_code == 200 and res.headers["content-type"].startswith("image/png")
            assert client.get(prefix + "missing.js").status_code == 404
            assert client.get(prefix + "missing.webmanifest").status_code == 404
        assert client.get("/itertrip/..%2F..%2F.env").status_code == 404
        assert client.get("/api/health").json()["status"] == "ok"
    print("M28 backend: root/subpath shell, worker MIME/no-cache, manifest, PNG icons and missing-file/traversal checks passed")


if __name__ == "__main__":
    main()
