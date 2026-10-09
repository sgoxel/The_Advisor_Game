import { test, expect } from "@playwright/test";
import { orientationTests } from "../orientation-browser.js";
orientationTests(test, expect, true);
