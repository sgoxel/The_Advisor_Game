import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

import tile_atlas_tool as tool


def metadata():
    cells = tool.default_cells()
    for i, cell in enumerate(cells):
        cell["semantic_type"] = f"cell_{i:02d}"
        cell["description"] = f"Cell {i}"
        cell["display_name"] = f"Cell {i}"
        cell["category"] = "terrain"
        cell["runtime_usage"] = "terrain/base"
    return cells


class TileAtlasToolTests(unittest.TestCase):
    def test_square_sources_normalize_to_1024(self):
        for size in (960, 1280):
            with self.subTest(size=size), tempfile.TemporaryDirectory() as td:
                root = Path(td)
                source = root / "source.png"
                Image.new("RGBA", (size, size), (20, 80, 20, 255)).save(source)
                result = tool.process(
                    source, root / "out", "grass", "fit", cells=metadata(), require_metadata=True
                )
                atlas = result["manifest"]["atlas"]
                self.assertEqual((atlas["width"], atlas["height"]), (1024, 1024))
                self.assertEqual((atlas["sourceWidth"], atlas["sourceHeight"]), (size, size))
                with Image.open(root / "out" / "grass_atlas_1024px.png") as image:
                    self.assertEqual(image.size, (1024, 1024))
                    self.assertEqual(image.mode, "RGBA")

    def test_one_pixel_cell_border_is_removed_from_derived_tile(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / "source.png"
            image = Image.new("RGBA", (1024, 1024), (0, 0, 0, 255))
            draw = ImageDraw.Draw(image)
            for index in range(16):
                row, col = divmod(index, 4)
                left, top = col * 256, row * 256
                draw.rectangle((left + 1, top + 1, left + 254, top + 254), fill=(20, 200, 40, 255))
            image.save(source)

            tool.process(source, root / "out", "grass", cells=metadata(), require_metadata=True)
            with Image.open(root / "out" / "grass_cell_00_256px.png") as tile:
                self.assertEqual(tile.getpixel((0, 0))[:3], (20, 200, 40))
                self.assertEqual(tile.size, (256, 256))

    def test_duplicate_semantic_type_fails(self):
        cells = metadata()
        cells[1]["semantic_type"] = cells[0]["semantic_type"]
        errors = tool.validate_metadata("grass", cells)
        self.assertTrue(any("Duplicate semantic type" in error for error in errors))

    def test_publish_to_project_uses_fixed_family_path_and_schema(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / ".github").mkdir()
            (root / "README.md").write_text("# Project\n", encoding="utf-8")
            source = root / "source.png"
            Image.new("RGBA", (960, 960), (40, 100, 40, 255)).save(source)

            result = tool.publish_to_project(source, root, "grass", "fit", metadata())
            target = root / "textures" / "tiles" / "grass"
            self.assertEqual(Path(result["output_dir"]), target)
            manifest = json.loads((target / "grass_tiles.manifest.json").read_text(encoding="utf-8"))
            descriptions = json.loads(
                (target / "grass_tiles.descriptions.json").read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["version"], tool.SCHEMA_VERSION)
            self.assertEqual(descriptions["version"], tool.SCHEMA_VERSION)
            self.assertEqual(len(manifest["tiles"]), 16)
            self.assertEqual(manifest["tiles"][0]["type"], "cell_00")
            self.assertEqual(descriptions["tiles"][0]["description"], "Cell 0")


if __name__ == "__main__":
    unittest.main()
