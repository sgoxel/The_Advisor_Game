import { test, expect } from "@playwright/test";
import { continuityTests } from "../continuity-browser.js";

continuityTests(test, expect, false);
