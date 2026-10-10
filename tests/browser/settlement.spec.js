import { test, expect } from "@playwright/test";
import { settlementBrowserTests } from "../settlement-browser.js";

settlementBrowserTests(test, expect, true);
