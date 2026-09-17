import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

import tile_atlas_tool as tool


def cells_with(**overrides):
    cells = tool.default_cells()
    for cell in cells:
        cell.update({"unused": True, "category": "prop", "runtime_usage": "presentation"})
    for index, data in overrides.items():
        cell = cells[int(index)]
        cell.update(data)
        cell["unused"] = False
    return cells


class TileAtlasToolTests(unittest.TestCase):
    def test_square_source_normalizes_to_canonical_geometry(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / "source.png"
            Image.new("RGBA", (1254, 1254), (20, 80, 20, 255)).save(source)
            result = tool.process_atlas(source, root / "out", "grass")
            atlas = result["manifest"]["atlas"]
            self.assertEqual((atlas["width"], atlas["height"]), (1000, 1000))
            self.assertEqual((atlas["columns"], atlas["rows"]), (10, 10))
            with Image.open(root / "out" / "grass_atlas_1000px.png") as image:
                self.assertEqual(image.size, (1000, 1000))
                self.assertEqual(image.mode, "RGBA")

    def test_prop_alpha_crop_upscale_and_center(self):
        source = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
        ImageDraw.Draw(source).rectangle((5, 20, 24, 49), fill=(255, 0, 0, 255))
        cell = {
            "category": "prop",
            "runtime_usage": "presentation",
            "unused": False,
            "semantic_type": "crate",
        }
        output, info = tool._render_cell(source, cell, True, 4, "generic")
        bbox = output.getchannel("A").getbbox()
        self.assertIsNotNone(bbox)
        left, top, right, bottom = bbox
        self.assertGreaterEqual(left, 3)
        self.assertGreaterEqual(top, 3)
        self.assertLessEqual(right, 97)
        self.assertLessEqual(bottom, 97)
        self.assertAlmostEqual((left + right) / 2, 50, delta=2)
        self.assertAlmostEqual((top + bottom) / 2, 50, delta=2)
        self.assertIn("alpha_bbox_crop", info["actions"])
        self.assertIn("contained_to_cell", info["actions"])

    def test_floor_alpha_crop_fills_entire_tile(self):
        source = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
        ImageDraw.Draw(source).rectangle((20, 30, 69, 79), fill=(90, 70, 50, 255))
        cell = {
            "category": "floor",
            "runtime_usage": "floor",
            "unused": False,
            "semantic_type": "floor",
        }
        output, info = tool._render_cell(source, cell, True, 4, "generic")
        self.assertEqual(output.getchannel("A").getbbox(), (0, 0, 100, 100))
        self.assertIn("alpha_bbox_crop", info["actions"])
        self.assertIn("alpha_crop_filled_to_cell", info["actions"])

    def test_horizontal_structure_preserves_declared_edges(self):
        source = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
        ImageDraw.Draw(source).rectangle((0, 40, 99, 59), fill=(120, 90, 60, 255))
        cell = {
            "category": "wall",
            "runtime_usage": "structure",
            "unused": False,
            "semantic_type": "wall_h",
            "edge_policy": ["left", "right"],
        }
        _, info = tool._render_cell(source, cell, True, 4, "generic")
        contact = info["outputEdgeContact"]
        self.assertGreater(contact["left"], 0.05)
        self.assertGreater(contact["right"], 0.05)
        self.assertEqual(contact["top"], 0.0)
        self.assertEqual(contact["bottom"], 0.0)
        self.assertFalse(info["forbiddenEdgeContact"])
        self.assertIn("semantic_edges_anchored", info["actions"])

    def test_vertical_structure_preserves_declared_edges(self):
        source = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
        ImageDraw.Draw(source).rectangle((40, 0, 59, 99), fill=(120, 90, 60, 255))
        cell = {
            "category": "threshold",
            "runtime_usage": "structure",
            "unused": False,
            "semantic_type": "threshold_v",
            "edge_policy": ["top", "bottom"],
        }
        _, info = tool._render_cell(source, cell, True, 4, "generic")
        contact = info["outputEdgeContact"]
        self.assertGreater(contact["top"], 0.05)
        self.assertGreater(contact["bottom"], 0.05)
        self.assertEqual(contact["left"], 0.0)
        self.assertEqual(contact["right"], 0.0)

    def test_source_boundary_contact_is_informational_after_prop_normalization(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / "source.png"
            atlas = Image.new("RGBA", (1000, 1000), (0, 0, 0, 0))
            draw = ImageDraw.Draw(atlas)
            draw.rectangle((70, 20, 99, 79), fill=(255, 0, 0, 255))
            draw.rectangle((100, 20, 129, 79), fill=(0, 255, 0, 255))
            atlas.save(source)
            cells = cells_with(**{
                "0": {"semantic_type": "prop_a", "category": "prop"},
                "1": {"semantic_type": "prop_b", "category": "prop"},
            })
            result = tool.process_atlas(source, root / "out", "market_shop", cells=cells)
            self.assertGreater(len(result["qa"]["sourceCrossBoundaryCandidates"]), 0)
            self.assertEqual(result["qa"]["crossBoundaryCandidates"], [])
            self.assertFalse(any("canonical cross-cell" in warning for warning in result["qa"]["warnings"]))

    def test_declared_structural_seam_is_not_unexplained(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / "source.png"
            atlas = Image.new("RGBA", (1000, 1000), (0, 0, 0, 0))
            draw = ImageDraw.Draw(atlas)
            draw.rectangle((0, 40, 99, 59), fill=(120, 90, 60, 255))
            draw.rectangle((100, 40, 199, 59), fill=(120, 90, 60, 255))
            atlas.save(source)
            cells = cells_with(**{
                "0": {"semantic_type": "wall_a", "category": "wall", "edge_policy": ["left", "right"]},
                "1": {"semantic_type": "wall_b", "category": "wall", "edge_policy": ["left", "right"]},
            })
            result = tool.process_atlas(source, root / "out", "market_shop", cells=cells)
            candidates = result["qa"]["crossBoundaryCandidates"]
            self.assertTrue(any(
                candidate["a"] == 0
                and candidate["b"] == 1
                and candidate["declaredOrInferredSeam"]
                for candidate in candidates
            ))
            self.assertFalse(any("canonical cross-cell" in warning for warning in result["qa"]["warnings"]))


if __name__ == "__main__":
    unittest.main()
