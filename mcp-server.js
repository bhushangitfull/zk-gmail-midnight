#!/usr/bin/env node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var path_1 = require("path");
var promises_1 = require("fs/promises");
var os_1 = require("os");
var url_1 = require("url");
var googleapis_1 = require("googleapis");
var google_auth_library_1 = require("google-auth-library");
var zod_1 = require("zod");
var zod_to_json_schema_1 = require("zod-to-json-schema");
var index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
var stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
var types_js_1 = require("@modelcontextprotocol/sdk/types.js");
var __dirname = path_1.default.dirname((0, url_1.fileURLToPath)(import.meta.url));
var CONFIG_DIR = path_1.default.join(os_1.default.homedir(), ".gmail-mcp");
var OAUTH_PATH = process.env.GMAIL_OAUTH_PATH || path_1.default.join(CONFIG_DIR, "gcp-oauth.keys.json");
var CREDENTIALS_PATH = process.env.GMAIL_CREDENTIALS_PATH || path_1.default.join(CONFIG_DIR, "credentials.json");
var oauth2Client;
/* --- Simple credential loader (expects credentials.json and gcp-oauth.keys.json to exist) --- */
function loadAndAuth() {
    return __awaiter(this, void 0, void 0, function () {
        var credsRaw, tokenRaw, creds, tokens, _a, client_id, client_secret, redirect_uris;
        var _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, promises_1.default.readFile(CREDENTIALS_PATH, "utf8").catch(function () {
                        throw new Error("Missing credentials file at ".concat(CREDENTIALS_PATH));
                    })];
                case 1:
                    credsRaw = _d.sent();
                    return [4 /*yield*/, promises_1.default.readFile(OAUTH_PATH, "utf8").catch(function () {
                            throw new Error("Missing oauth tokens file at ".concat(OAUTH_PATH));
                        })];
                case 2:
                    tokenRaw = _d.sent();
                    creds = JSON.parse(credsRaw);
                    tokens = JSON.parse(tokenRaw);
                    _a = (_c = (_b = creds.installed) !== null && _b !== void 0 ? _b : creds.web) !== null && _c !== void 0 ? _c : {}, client_id = _a.client_id, client_secret = _a.client_secret, redirect_uris = _a.redirect_uris;
                    if (!client_id || !client_secret) {
                        throw new Error("Invalid credentials.json - missing client_id / client_secret");
                    }
                    oauth2Client = new google_auth_library_1.OAuth2Client(client_id, client_secret, (redirect_uris && redirect_uris[0]) || undefined);
                    oauth2Client.setCredentials(tokens);
                    return [2 /*return*/];
            }
        });
    });
}
/* --- Schemas --- */
var DeleteEmailSchema = zod_1.z.object({
    messageId: zod_1.z.string().describe("ID of the email message to delete"),
});
var BatchDeleteEmailsSchema = zod_1.z.object({
    messageIds: zod_1.z.array(zod_1.z.string()).describe("List of message IDs to delete"),
    batchSize: zod_1.z.number().optional().default(50).describe("Number of messages to process in each batch (default: 50)"),
});
/* --- Helper: process in batches with per-item failure tracking --- */
function processBatches(items, batchSize, fn) {
    return __awaiter(this, void 0, void 0, function () {
        var successes, failures, i, batch, res, batchErr_1;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    successes = [];
                    failures = [];
                    i = 0;
                    _a.label = 1;
                case 1:
                    if (!(i < items.length)) return [3 /*break*/, 7];
                    batch = items.slice(i, i + batchSize);
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 6]);
                    return [4 /*yield*/, fn(batch)];
                case 3:
                    res = _a.sent();
                    successes.push.apply(successes, res);
                    return [3 /*break*/, 6];
                case 4:
                    batchErr_1 = _a.sent();
                    // fallback to individual processing to collect granular failures
                    return [4 /*yield*/, Promise.all(batch.map(function (item) { return __awaiter(_this, void 0, void 0, function () {
                            var r, err_1;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        _a.trys.push([0, 2, , 3]);
                                        return [4 /*yield*/, fn([item])];
                                    case 1:
                                        r = _a.sent();
                                        successes.push.apply(successes, r);
                                        return [3 /*break*/, 3];
                                    case 2:
                                        err_1 = _a.sent();
                                        failures.push({ item: item, error: err_1 });
                                        return [3 /*break*/, 3];
                                    case 3: return [2 /*return*/];
                                }
                            });
                        }); }))];
                case 5:
                    // fallback to individual processing to collect granular failures
                    _a.sent();
                    return [3 /*break*/, 6];
                case 6:
                    i += batchSize;
                    return [3 /*break*/, 1];
                case 7: return [2 /*return*/, { successes: successes, failures: failures }];
            }
        });
    });
}
/* --- Tools metadata for ListToolsRequest --- */
var deletionTools = [
    {
        name: "delete_email",
        description: "Permanently delete a single Gmail message by messageId",
        inputSchema: (0, zod_to_json_schema_1.zodToJsonSchema)(DeleteEmailSchema),
    },
    {
        name: "batch_delete_emails",
        description: "Permanently delete multiple Gmail messages by messageIds in batches",
        inputSchema: (0, zod_to_json_schema_1.zodToJsonSchema)(BatchDeleteEmailsSchema),
    },
];
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var gmail, server, transport;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, loadAndAuth()];
                case 1:
                    _a.sent();
                    gmail = googleapis_1.google.gmail({ version: "v1", auth: oauth2Client });
                    server = new index_js_1.Server({
                        name: "gmail-delete-only",
                        version: "1.0.0",
                        capabilities: { tools: {} },
                    });
                    server.setRequestHandler(types_js_1.ListToolsRequestSchema, function () { return __awaiter(_this, void 0, void 0, function () {
                        return __generator(this, function (_a) {
                            return [2 /*return*/, ({
                                    tools: deletionTools,
                                })];
                        });
                    }); });
                    server.setRequestHandler(types_js_1.CallToolRequestSchema, function (req) { return __awaiter(_this, void 0, void 0, function () {
                        var _a, name, args, _b, v, v, messageIds, batchSize, _c, successes, failures, text, err_2;
                        var _this = this;
                        return __generator(this, function (_d) {
                            switch (_d.label) {
                                case 0:
                                    _a = req.params, name = _a.name, args = _a.arguments;
                                    _d.label = 1;
                                case 1:
                                    _d.trys.push([1, 8, , 9]);
                                    _b = name;
                                    switch (_b) {
                                        case "delete_email": return [3 /*break*/, 2];
                                        case "batch_delete_emails": return [3 /*break*/, 4];
                                    }
                                    return [3 /*break*/, 6];
                                case 2:
                                    v = DeleteEmailSchema.parse(args);
                                    return [4 /*yield*/, gmail.users.messages.delete({ userId: "me", id: v.messageId })];
                                case 3:
                                    _d.sent();
                                    return [2 /*return*/, { content: [{ type: "text", text: "Deleted message ".concat(v.messageId) }] }];
                                case 4:
                                    v = BatchDeleteEmailsSchema.parse(args);
                                    messageIds = v.messageIds, batchSize = v.batchSize;
                                    return [4 /*yield*/, processBatches(messageIds, batchSize || 50, function (batch) { return __awaiter(_this, void 0, void 0, function () {
                                            return __generator(this, function (_a) {
                                                switch (_a.label) {
                                                    case 0: return [4 /*yield*/, Promise.all(batch.map(function (mid) { return gmail.users.messages.delete({ userId: "me", id: mid }); }))];
                                                    case 1:
                                                        _a.sent();
                                                        return [2 /*return*/, batch.map(function (mid) { return ({ messageId: mid }); })];
                                                }
                                            });
                                        }); })];
                                case 5:
                                    _c = _d.sent(), successes = _c.successes, failures = _c.failures;
                                    text = "Batch delete complete. Successes: ".concat(successes.length, ". Failures: ").concat(failures.length, ".");
                                    if (failures.length) {
                                        text += "\nFailed IDs:\n" + failures.map(function (f) { return "- ".concat(String(f.item), " (").concat(f.error.message, ")"); }).join("\n");
                                    }
                                    return [2 /*return*/, { content: [{ type: "text", text: text }] }];
                                case 6: return [2 /*return*/, { content: [{ type: "text", text: "Unknown tool: ".concat(name) }] }];
                                case 7: return [3 /*break*/, 9];
                                case 8:
                                    err_2 = _d.sent();
                                    return [2 /*return*/, { content: [{ type: "text", text: "Error: ".concat((err_2 === null || err_2 === void 0 ? void 0 : err_2.message) || String(err_2)) }] }];
                                case 9: return [2 /*return*/];
                            }
                        });
                    }); });
                    transport = new stdio_js_1.StdioServerTransport();
                    server.connect(transport);
                    return [2 /*return*/];
            }
        });
    });
}
main().catch(function (err) {
    console.error("Fatal:", err);
    process.exit(1);
});
