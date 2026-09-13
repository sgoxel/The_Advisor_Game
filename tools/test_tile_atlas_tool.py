import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

import tile_atlas_tool as tool


class TileAtlasToolTests(unittest.TestCase):
    def test_square_source_normalizes_to_1000_and_emits_100_tiles(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / "source.png"
            Image.new("RGB", (1254, 1254), (20, 80, 20)).save(source)
            result = tool.process(source, root / "out", "grass", "fit")
            self.assertEqual(result["emitted_count"], 100)
            atlas = result["manifest"]["atlas"]
            self.assertEqual((atlas["width"], atlas["height"]), (1000, 1000))
            self.assertEqual((atlas["columns"], atlas["rows"]), (10, 10))
            with Image.open(root / "out" / "grass_atlas_1000px.png") as image:
                self.assertEqual(image.size, (1000, 1000))
                self.assertEqual(image.mode, "RGBA")
            tiles = sorted((root / "out").glob("grass_*_100px.png"))
            self.assertEqual(len(tiles), 100)
            with Image.open(tiles[0]) as tile:
                self.assertEqual(tile.size, (100, 100))
                self.assertEqual(tile.mode, "RGBA")

    def test_slice_is_exact_without_border_trim(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / "source.png"
            image = Image.new("RGBA", (1000, 1000), (0, 0, 0, 255))
            for row in range(10):
                for col in range(10):
                    color = (row * 20, col * 20, 30, 255)
                    for y in range(row * 100, (row + 1) * 100):
                        for x in range(col * 100, (col + 1) * 100):
                            image.putpixel((x, y), color)
            image.save(source)
            tool.process(source, root / "out", "grass")
            with Image.open(root / "out" / "grass_r03_c07_100px.png") as tile:
                self.assertEqual(tile.getpixel((0, 0)), (60, 140, 30, 255))
                self.assertEqual(tile.getpixel((99, 99)), (60, 140, 30, 255))

    def test_manifest_schema_has_100_runtime_tiles(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / "source.png"
            Image.new("RGBA", (1000, 1000), (1, 2, 3, 255)).save(source)
            tool.process(source, root / "out", "grass")
            manifest = json.loads((root / "out" / "grass_tiles.manifest.json").read_text())
            self.assertEqual(manifest["version"], 3)
            self.assertEqual(manifest["atlas"]["cellSize"], 100)
            self.assertEqual(len(manifest["tiles"]), 100)
            self.assertEqual(manifest["derivedTilePolicy"]["borderTrimPx"], 0)

    def test_github_publisher_creates_one_blob_per_file_then_tree_commit_ref(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            png1 = root / "a.png"
            png2 = root / "b.png"
            meta = root / "m.json"
            Image.new("RGBA", (100, 100), (1, 2, 3, 255)).save(png1)
            Image.new("RGBA", (100, 100), (4, 5, 6, 255)).save(png2)
            meta.write_text('{"x":1}\n', encoding="utf-8")
            calls = []

            def fake(api, token, method, path, payload=None):
                calls.append((method, path, payload))
                if method == "GET" and "/git/ref/heads/" in path:
                    return {"object": {"sha": "parent"}}
                if method == "GET" and "/git/commits/" in path:
                    return {"tree": {"sha": "base-tree"}}
                if method == "POST" and path.endswith("/git/blobs"):
                    return {"sha": f"blob-{sum(1 for c in calls if c[1].endswith('/git/blobs'))}"}
                if method == "POST" and path.endswith("/git/trees"):
                    return {"sha": "tree-new"}
                if method == "POST" and path.endswith("/git/commits"):
                    return {"sha": "commit-new"}
                if method == "PATCH" and "/git/refs/heads/" in path:
                    return {"object": {"sha": "commit-new"}}
                raise AssertionError((method, path))

            with patch.object(tool, "_github_request", side_effect=fake):
                result = tool.publish_files_to_github(
                    [png1, png2, meta],
                    "owner/repo",
                    "main",
                    "textures/tiles/grass",
                    "token",
                    "publish",
                )
            self.assertEqual(result["commit"], "commit-new")
            blob_calls = [c for c in calls if c[1].endswith("/git/blobs")]
            self.assertEqual(len(blob_calls), 3)
            self.assertEqual(blob_calls[0][2]["encoding"], "base64")
            self.assertEqual(blob_calls[1][2]["encoding"], "base64")
            self.assertEqual(blob_calls[2][2]["encoding"], "utf-8")
            tree_call = next(c for c in calls if c[1].endswith("/git/trees"))
            self.assertEqual(len(tree_call[2]["tree"]), 3)


if __name__ == "__main__":
    unittest.main()
