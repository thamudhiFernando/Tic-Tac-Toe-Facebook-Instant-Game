"use strict";
{
    window.DOMHandler = class DOMHandler {
        constructor(iRuntime, componentId) {
            this._iRuntime = iRuntime;
            this._componentId = componentId;
            this._hasTickCallback = false;
            this._tickCallback = () => this.Tick();
        }
        Attach() {}
        PostToRuntime(handler, data, dispatchOpts, transferables) {
            this._iRuntime.PostToRuntimeComponent(
                this._componentId,
                handler,
                data,
                dispatchOpts,
                transferables
            );
        }
        PostToRuntimeAsync(handler, data, dispatchOpts, transferables) {
            return this._iRuntime.PostToRuntimeComponentAsync(
                this._componentId,
                handler,
                data,
                dispatchOpts,
                transferables
            );
        }
        _PostToRuntimeMaybeSync(name, data, dispatchOpts) {
            if (this._iRuntime.UsesWorker())
                this.PostToRuntime(name, data, dispatchOpts);
            else
                this._iRuntime
                    ._GetLocalRuntime()
                    ["_OnMessageFromDOM"]({
                    type: "event",
                    component: this._componentId,
                    handler: name,
                    dispatchOpts: dispatchOpts || null,
                    data: data,
                    responseId: null,
                });
        }
        AddRuntimeMessageHandler(handler, func) {
            this._iRuntime.AddRuntimeComponentMessageHandler(
                this._componentId,
                handler,
                func
            );
        }
        AddRuntimeMessageHandlers(list) {
            for (const [handler, func] of list)
                this.AddRuntimeMessageHandler(handler, func);
        }
        GetRuntimeInterface() {
            return this._iRuntime;
        }
        GetComponentID() {
            return this._componentId;
        }
        _StartTicking() {
            if (this._hasTickCallback) return;
            this._iRuntime._AddRAFCallback(this._tickCallback);
            this._hasTickCallback = true;
        }
        _StopTicking() {
            if (!this._hasTickCallback) return;
            this._iRuntime._RemoveRAFCallback(this._tickCallback);
            this._hasTickCallback = false;
        }
        Tick() {}
    };
    window.RateLimiter = class RateLimiter {
        constructor(callback, interval) {
            this._callback = callback;
            this._interval = interval;
            this._timerId = -1;
            this._lastCallTime = -Infinity;
            this._timerCallFunc = () => this._OnTimer();
            this._ignoreReset = false;
            this._canRunImmediate = false;
        }
        SetCanRunImmediate(c) {
            this._canRunImmediate = !!c;
        }
        Call() {
            if (this._timerId !== -1) return;
            const nowTime = Date.now();
            const timeSinceLastCall = nowTime - this._lastCallTime;
            const interval = this._interval;
            if (timeSinceLastCall >= interval && this._canRunImmediate) {
                this._lastCallTime = nowTime;
                this._RunCallback();
            } else
                this._timerId = self.setTimeout(
                    this._timerCallFunc,
                    Math.max(interval - timeSinceLastCall, 4)
                );
        }
        _RunCallback() {
            this._ignoreReset = true;
            this._callback();
            this._ignoreReset = false;
        }
        Reset() {
            if (this._ignoreReset) return;
            this._CancelTimer();
            this._lastCallTime = Date.now();
        }
        _OnTimer() {
            this._timerId = -1;
            this._lastCallTime = Date.now();
            this._RunCallback();
        }
        _CancelTimer() {
            if (this._timerId !== -1) {
                self.clearTimeout(this._timerId);
                this._timerId = -1;
            }
        }
        Release() {
            this._CancelTimer();
            this._callback = null;
            this._timerCallFunc = null;
        }
    };
}

("use strict");
{
    window.DOMElementHandler = class DOMElementHandler extends self.DOMHandler {
        constructor(iRuntime, componentId) {
            super(iRuntime, componentId);
            this._elementMap = new Map();
            this._autoAttach = true;
            this.AddRuntimeMessageHandlers([
                ["create", (e) => this._OnCreate(e)],
                ["destroy", (e) => this._OnDestroy(e)],
                ["set-visible", (e) => this._OnSetVisible(e)],
                ["update-position", (e) => this._OnUpdatePosition(e)],
                ["update-state", (e) => this._OnUpdateState(e)],
                ["focus", (e) => this._OnSetFocus(e)],
                ["set-css-style", (e) => this._OnSetCssStyle(e)],
                ["set-attribute", (e) => this._OnSetAttribute(e)],
                ["remove-attribute", (e) => this._OnRemoveAttribute(e)],
            ]);
            this.AddDOMElementMessageHandler("get-element", (elem) => elem);
        }
        SetAutoAttach(e) {
            this._autoAttach = !!e;
        }
        AddDOMElementMessageHandler(handler, func) {
            this.AddRuntimeMessageHandler(handler, (e) => {
                const elementId = e["elementId"];
                const elem = this._elementMap.get(elementId);
                return func(elem, e);
            });
        }
        _OnCreate(e) {
            const elementId = e["elementId"];
            const elem = this.CreateElement(elementId, e);
            this._elementMap.set(elementId, elem);
            if (!e["isVisible"]) elem.style.display = "none";
            const focusElem = this._GetFocusElement(elem);
            focusElem.addEventListener("focus", (e) => this._OnFocus(elementId));
            focusElem.addEventListener("blur", (e) => this._OnBlur(elementId));
            if (this._autoAttach) document.body.appendChild(elem);
        }
        CreateElement(elementId, e) {
            throw new Error("required override");
        }
        DestroyElement(elem) {}
        _OnDestroy(e) {
            const elementId = e["elementId"];
            const elem = this._elementMap.get(elementId);
            this.DestroyElement(elem);
            if (this._autoAttach) elem.parentElement.removeChild(elem);
            this._elementMap.delete(elementId);
        }
        PostToRuntimeElement(handler, elementId, data) {
            if (!data) data = {};
            data["elementId"] = elementId;
            this.PostToRuntime(handler, data);
        }
        _PostToRuntimeElementMaybeSync(handler, elementId, data) {
            if (!data) data = {};
            data["elementId"] = elementId;
            this._PostToRuntimeMaybeSync(handler, data);
        }
        _OnSetVisible(e) {
            if (!this._autoAttach) return;
            const elem = this._elementMap.get(e["elementId"]);
            elem.style.display = e["isVisible"] ? "" : "none";
        }
        _OnUpdatePosition(e) {
            if (!this._autoAttach) return;
            const elem = this._elementMap.get(e["elementId"]);
            elem.style.left = e["left"] + "px";
            elem.style.top = e["top"] + "px";
            elem.style.width = e["width"] + "px";
            elem.style.height = e["height"] + "px";
            const fontSize = e["fontSize"];
            if (fontSize !== null) elem.style.fontSize = fontSize + "em";
        }
        _OnUpdateState(e) {
            const elem = this._elementMap.get(e["elementId"]);
            this.UpdateState(elem, e);
        }
        UpdateState(elem, e) {
            throw new Error("required override");
        }
        _GetFocusElement(elem) {
            return elem;
        }
        _OnFocus(elementId) {
            this.PostToRuntimeElement("elem-focused", elementId);
        }
        _OnBlur(elementId) {
            this.PostToRuntimeElement("elem-blurred", elementId);
        }
        _OnSetFocus(e) {
            const elem = this._GetFocusElement(this._elementMap.get(e["elementId"]));
            if (e["focus"]) elem.focus();
            else elem.blur();
        }
        _OnSetCssStyle(e) {
            const elem = this._elementMap.get(e["elementId"]);
            elem.style[e["prop"]] = e["val"];
        }
        _OnSetAttribute(e) {
            const elem = this._elementMap.get(e["elementId"]);
            elem.setAttribute(e["name"], e["val"]);
        }
        _OnRemoveAttribute(e) {
            const elem = this._elementMap.get(e["elementId"]);
            elem.removeAttribute(e["name"]);
        }
        GetElementById(elementId) {
            return this._elementMap.get(elementId);
        }
    };
}

("use strict");
{
    const isiOSLike = /(iphone|ipod|ipad|macos|macintosh|mac os x)/i.test(
        navigator.userAgent
    );
    let resolveCounter = 0;
    function AddScript(url, type) {
        const elem = document.createElement("script");
        elem.async = false;
        if (type === "module") elem.type = "module";
        if (url.isStringSrc)
            return new Promise((resolve) => {
                const resolveName = "c3_resolve_" + resolveCounter;
                ++resolveCounter;
                self[resolveName] = resolve;
                elem.textContent = url.str + `\n\nself["${resolveName}"]();`;
                document.head.appendChild(elem);
            });
        else
            return new Promise((resolve, reject) => {
                elem.onload = resolve;
                elem.onerror = reject;
                elem.src = url;
                document.head.appendChild(elem);
            });
    }
    let didCheckWorkerModuleSupport = false;
    let isWorkerModuleSupported = false;
    function SupportsWorkerTypeModule() {
        if (!didCheckWorkerModuleSupport) {
            try {
                new Worker("blob://", {
                    get type() {
                        isWorkerModuleSupported = true;
                    },
                });
            } catch (e) {}
            didCheckWorkerModuleSupport = true;
        }
        return isWorkerModuleSupported;
    }
    let tmpAudio = new Audio();
    const supportedAudioFormats = {
        "audio/webm; codecs=opus": !!tmpAudio.canPlayType(
            "audio/webm; codecs=opus"
        ),
        "audio/ogg; codecs=opus": !!tmpAudio.canPlayType("audio/ogg; codecs=opus"),
        "audio/webm; codecs=vorbis": !!tmpAudio.canPlayType(
            "audio/webm; codecs=vorbis"
        ),
        "audio/ogg; codecs=vorbis": !!tmpAudio.canPlayType(
            "audio/ogg; codecs=vorbis"
        ),
        "audio/mp4": !!tmpAudio.canPlayType("audio/mp4"),
        "audio/mpeg": !!tmpAudio.canPlayType("audio/mpeg"),
    };
    tmpAudio = null;
    async function BlobToString(blob) {
        const arrayBuffer = await BlobToArrayBuffer(blob);
        const textDecoder = new TextDecoder("utf-8");
        return textDecoder.decode(arrayBuffer);
    }
    function BlobToArrayBuffer(blob) {
        return new Promise((resolve, reject) => {
            const fileReader = new FileReader();
            fileReader.onload = (e) => resolve(e.target.result);
            fileReader.onerror = (err) => reject(err);
            fileReader.readAsArrayBuffer(blob);
        });
    }
    const queuedArrayBufferReads = [];
    let activeArrayBufferReads = 0;
    const MAX_ARRAYBUFFER_READS = 8;
    window["RealFile"] = window["File"];
    const domHandlerClasses = [];
    const runtimeEventHandlers = new Map();
    const pendingResponsePromises = new Map();
    let nextResponseId = 0;
    const runOnStartupFunctions = [];
    self.runOnStartup = function runOnStartup(f) {
        if (typeof f !== "function")
            throw new Error("runOnStartup called without a function");
        runOnStartupFunctions.push(f);
    };
    const WEBVIEW_EXPORT_TYPES = new Set([
        "cordova",
        "playable-ad",
        "instant-games",
    ]);
    function IsWebViewExportType(exportType) {
        return WEBVIEW_EXPORT_TYPES.has(exportType);
    }
    window.RuntimeInterface = class RuntimeInterface {
        constructor(opts) {
            this._useWorker = opts.useWorker;
            this._messageChannelPort = null;
            this._baseUrl = "";
            this._scriptFolder = opts.scriptFolder;
            this._scriptsType = opts.scriptsType;
            this._workerScriptURLs = {};
            this._worker = null;
            this._localRuntime = null;
            this._domHandlers = [];
            this._runtimeDomHandler = null;
            this._canvas = null;
            this._jobScheduler = null;
            this._rafId = -1;
            this._rafFunc = () => this._OnRAFCallback();
            this._rafCallbacks = [];
            this._exportType = opts.exportType;
            if (
                this._useWorker &&
                (typeof OffscreenCanvas === "undefined" ||
                    !navigator["userActivation"] ||
                    (this._scriptsType === "module" && !SupportsWorkerTypeModule()))
            )
                this._useWorker = false;
            if (IsWebViewExportType(this._exportType) && this._useWorker) {
                console.warn(
                    "[C3 runtime] Worker mode is enabled and supported, but is disabled in WebViews due to crbug.com/923007. Reverting to DOM mode."
                );
                this._useWorker = false;
            }
            this._localFileBlobs = null;
            this._localFileStrings = null;
            if (
                (this._exportType === "html5" || this._exportType === "playable-ad") &&
                location.protocol.substr(0, 4) === "file"
            )
                alert(
                    "Exported games won't work until you upload them. (When running on the file: protocol, browsers block many features from working for security reasons.)"
                );
            this.AddRuntimeComponentMessageHandler(
                "runtime",
                "cordova-fetch-local-file",
                (e) => this._OnCordovaFetchLocalFile(e)
            );
            this.AddRuntimeComponentMessageHandler(
                "runtime",
                "create-job-worker",
                (e) => this._OnCreateJobWorker(e)
            );
            if (this._exportType === "cordova")
                document.addEventListener("deviceready", () => this._Init(opts));
            else this._Init(opts);
        }
        Release() {
            this._CancelAnimationFrame();
            if (this._messageChannelPort) {
                this._messageChannelPort.onmessage = null;
                this._messageChannelPort = null;
            }
            if (this._worker) {
                this._worker.terminate();
                this._worker = null;
            }
            if (this._localRuntime) {
                this._localRuntime.Release();
                this._localRuntime = null;
            }
            if (this._canvas) {
                this._canvas.parentElement.removeChild(this._canvas);
                this._canvas = null;
            }
        }
        GetCanvas() {
            return this._canvas;
        }
        GetBaseURL() {
            return this._baseUrl;
        }
        UsesWorker() {
            return this._useWorker;
        }
        GetExportType() {
            return this._exportType;
        }
        GetScriptFolder() {
            return this._scriptFolder;
        }
        IsiOSCordova() {
            return isiOSLike && this._exportType === "cordova";
        }
        IsiOSWebView() {
            return (
                (isiOSLike && IsWebViewExportType(this._exportType)) ||
                navigator["standalone"]
            );
        }
        async _Init(opts) {
            if (this._exportType === "playable-ad") {
                this._localFileBlobs = self["c3_base64files"];
                this._localFileStrings = {};
                await this._ConvertDataUrisToBlobs();
                for (let i = 0, len = opts.engineScripts.length; i < len; ++i) {
                    const src = opts.engineScripts[i].toLowerCase();
                    if (this._localFileStrings.hasOwnProperty(src))
                        opts.engineScripts[i] = {
                            isStringSrc: true,
                            str: this._localFileStrings[src],
                        };
                    else if (this._localFileBlobs.hasOwnProperty(src))
                        opts.engineScripts[i] = URL.createObjectURL(
                            this._localFileBlobs[src]
                        );
                }
            }
            if (opts.baseUrl) this._baseUrl = opts.baseUrl;
            else {
                const origin = location.origin;
                this._baseUrl =
                    (origin === "null" ? "file:///" : origin) + location.pathname;
                const i = this._baseUrl.lastIndexOf("/");
                if (i !== -1) this._baseUrl = this._baseUrl.substr(0, i + 1);
            }
            if (opts.workerScripts) this._workerScriptURLs = opts.workerScripts;
            const messageChannel = new MessageChannel();
            this._messageChannelPort = messageChannel.port1;
            this._messageChannelPort.onmessage = (e) =>
                this["_OnMessageFromRuntime"](e.data);
            if (window["c3_addPortMessageHandler"])
                window["c3_addPortMessageHandler"]((e) =>
                    this._OnMessageFromDebugger(e)
                );
            this._jobScheduler = new self.JobSchedulerDOM(this);
            await this._jobScheduler.Init();
            if (typeof window["StatusBar"] === "object")
                window["StatusBar"]["hide"]();
            if (typeof window["AndroidFullScreen"] === "object")
                window["AndroidFullScreen"]["immersiveMode"]();
            if (this._useWorker) await this._InitWorker(opts, messageChannel.port2);
            else await this._InitDOM(opts, messageChannel.port2);
        }
        _GetWorkerURL(url) {
            let ret;
            if (this._workerScriptURLs.hasOwnProperty(url))
                ret = this._workerScriptURLs[url];
            else if (
                url.endsWith("/workermain.js") &&
                this._workerScriptURLs.hasOwnProperty("workermain.js")
            )
                ret = this._workerScriptURLs["workermain.js"];
            else if (
                this._exportType === "playable-ad" &&
                this._localFileBlobs.hasOwnProperty(url.toLowerCase())
            )
                ret = this._localFileBlobs[url.toLowerCase()];
            else ret = url;
            if (ret instanceof Blob) ret = URL.createObjectURL(ret);
            return ret;
        }
        async CreateWorker(url, baseUrl, workerOpts) {
            if (url.startsWith("blob:")) return new Worker(url, workerOpts);
            if (this.IsiOSCordova() && location.protocol === "file:") {
                const arrayBuffer = await this.CordovaFetchLocalFileAsArrayBuffer(
                    this._scriptFolder + url
                );
                const blob = new Blob([arrayBuffer], {
                    type: "application/javascript",
                });
                return new Worker(URL.createObjectURL(blob), workerOpts);
            }
            const absUrl = new URL(url, baseUrl);
            const isCrossOrigin = location.origin !== absUrl.origin;
            if (isCrossOrigin) {
                const response = await fetch(absUrl);
                if (!response.ok) throw new Error("failed to fetch worker script");
                const blob = await response.blob();
                return new Worker(URL.createObjectURL(blob), workerOpts);
            } else return new Worker(absUrl, workerOpts);
        }
        _GetWindowInnerWidth() {
            return Math.max(window.innerWidth, 1);
        }
        _GetWindowInnerHeight() {
            return Math.max(window.innerHeight, 1);
        }
        _GetCommonRuntimeOptions(opts) {
            return {
                baseUrl: this._baseUrl,
                windowInnerWidth: this._GetWindowInnerWidth(),
                windowInnerHeight: this._GetWindowInnerHeight(),
                devicePixelRatio: window.devicePixelRatio,
                isFullscreen: RuntimeInterface.IsDocumentFullscreen(),
                projectData: opts.projectData,
                scriptsType: opts.scriptsType,
                previewImageBlobs:
                    window["cr_previewImageBlobs"] || this._localFileBlobs,
                previewProjectFileBlobs: window["cr_previewProjectFileBlobs"],
                previewProjectFileSWUrls: window["cr_previewProjectFiles"],
                swClientId: window.cr_swClientId || "",
                exportType: opts.exportType,
                isDebug: self.location.search.indexOf("debug") > -1,
                ife: !!self.ife,
                jobScheduler: this._jobScheduler.GetPortData(),
                supportedAudioFormats: supportedAudioFormats,
                opusWasmScriptUrl:
                    window["cr_opusWasmScriptUrl"] || this._scriptFolder + "opus.wasm.js",
                opusWasmBinaryUrl:
                    window["cr_opusWasmBinaryUrl"] ||
                    this._scriptFolder + "opus.wasm.wasm",
                isiOSCordova: this.IsiOSCordova(),
                isiOSWebView: this.IsiOSWebView(),
                isFBInstantAvailable: typeof self["FBInstant"] !== "undefined",
            };
        }
        async _InitWorker(opts, port2) {
            const workerMainUrl = this._GetWorkerURL(opts.workerMainUrl);
            this._worker = await this.CreateWorker(workerMainUrl, this._baseUrl, {
                type: this._scriptsType,
                name: "Runtime",
            });
            this._canvas = document.createElement("canvas");
            this._canvas.style.display = "none";
            const offscreenCanvas = this._canvas["transferControlToOffscreen"]();
            document.body.appendChild(this._canvas);
            window["c3canvas"] = this._canvas;
            this._worker.postMessage(
                Object.assign(this._GetCommonRuntimeOptions(opts), {
                    type: "init-runtime",
                    isInWorker: true,
                    messagePort: port2,
                    canvas: offscreenCanvas,
                    workerDependencyScripts: opts.workerDependencyScripts || [],
                    engineScripts: opts.engineScripts,
                    projectScripts: opts.projectScripts,
                    mainProjectScript: opts.mainProjectScript,
                    projectScriptsStatus: self["C3_ProjectScriptsStatus"],
                }),
                [port2, offscreenCanvas, ...this._jobScheduler.GetPortTransferables()]
            );
            this._domHandlers = domHandlerClasses.map((C) => new C(this));
            this._FindRuntimeDOMHandler();
            self["c3_callFunction"] = (name, params) =>
                this._runtimeDomHandler._InvokeFunctionFromJS(name, params);
            if (this._exportType === "preview")
                self["goToLastErrorScript"] = () =>
                    this.PostToRuntimeComponent("runtime", "go-to-last-error-script");
        }
        async _InitDOM(opts, port2) {
            this._canvas = document.createElement("canvas");
            this._canvas.style.display = "none";
            document.body.appendChild(this._canvas);
            window["c3canvas"] = this._canvas;
            this._domHandlers = domHandlerClasses.map((C) => new C(this));
            this._FindRuntimeDOMHandler();
            let engineScripts = opts.engineScripts.map((url) =>
                typeof url === "string" ? new URL(url, this._baseUrl).toString() : url
            );
            if (Array.isArray(opts.workerDependencyScripts))
                engineScripts.unshift(...opts.workerDependencyScripts);
            engineScripts = await Promise.all(
                engineScripts.map((url) =>
                    this._MaybeGetCordovaScriptURL(url, this._scriptsType)
                )
            );
            await Promise.all(
                engineScripts.map((url) => AddScript(url, this._scriptsType))
            );
            const scriptsStatus = self["C3_ProjectScriptsStatus"];
            if (this._scriptsType === "module") {
                const mainProjectScript = opts.mainProjectScript;
                const allProjectScripts = opts.projectScripts;
                for (let [originalUrl, loadUrl] of allProjectScripts) {
                    if (!loadUrl) loadUrl = originalUrl;
                    if (originalUrl === mainProjectScript)
                        try {
                            loadUrl = await this._MaybeGetCordovaScriptURL(
                                loadUrl,
                                this._scriptsType
                            );
                            await AddScript(loadUrl, this._scriptsType);
                            if (this._exportType === "preview" && !scriptsStatus[originalUrl])
                                this._ReportProjectMainScriptError(
                                    originalUrl,
                                    "main script did not run to completion"
                                );
                        } catch (err) {
                            this._ReportProjectMainScriptError(originalUrl, err);
                        }
                    else if (
                        originalUrl === "scriptsInEvents.js" ||
                        originalUrl.endsWith("/scriptsInEvents.js")
                    ) {
                        loadUrl = await this._MaybeGetCordovaScriptURL(
                            loadUrl,
                            this._scriptsType
                        );
                        await AddScript(loadUrl, this._scriptsType);
                    }
                }
            } else if (opts.projectScripts && opts.projectScripts.length > 0)
                try {
                    await Promise.all(
                        opts.projectScripts.map((e) => AddScript(e[1], this._scriptsType))
                    );
                    if (Object.values(scriptsStatus).some((f) => !f)) {
                        self.setTimeout(
                            () => this._ReportProjectScriptError(scriptsStatus),
                            100
                        );
                        return;
                    }
                } catch (err) {
                    console.error("[Preview] Error loading project scripts: ", err);
                    self.setTimeout(
                        () => this._ReportProjectScriptError(scriptsStatus),
                        100
                    );
                    return;
                }
            if (
                this._exportType === "preview" &&
                typeof self.C3.ScriptsInEvents !== "object"
            ) {
                this._RemoveLoadingMessage();
                const msg =
                    "Failed to load JavaScript code used in events. Check all your JavaScript code has valid syntax.";
                console.error("[C3 runtime] " + msg);
                alert(msg);
                return;
            }
            const runtimeOpts = Object.assign(this._GetCommonRuntimeOptions(opts), {
                isInWorker: false,
                messagePort: port2,
                canvas: this._canvas,
                runOnStartupFunctions: runOnStartupFunctions,
            });
            this._OnBeforeCreateRuntime();
            this._localRuntime = self["C3_CreateRuntime"](runtimeOpts);
            await self["C3_InitRuntime"](this._localRuntime, runtimeOpts);
        }
        _ReportProjectScriptError(scriptsStatus) {
            this._RemoveLoadingMessage();
            const failedScripts = Object.entries(scriptsStatus)
                .filter((e) => !e[1])
                .map((e) => e[0]);
            const msg = `Failed to load project script '${failedScripts[0]}'. Check all your JavaScript code has valid syntax.`;
            console.error("[Preview] " + msg);
            alert(msg);
        }
        _ReportProjectMainScriptError(url, err) {
            this._RemoveLoadingMessage();
            console.error(
                `[Preview] Failed to load project main script (${url}): `,
                err
            );
            alert(
                `Failed to load project main script (${url}). Check all your JavaScript code has valid syntax. Press F12 and check the console for error details.`
            );
        }
        _OnBeforeCreateRuntime() {
            this._RemoveLoadingMessage();
        }
        _RemoveLoadingMessage() {
            const loadingElem = window.cr_previewLoadingElem;
            if (loadingElem) {
                loadingElem.parentElement.removeChild(loadingElem);
                window.cr_previewLoadingElem = null;
            }
        }
        async _OnCreateJobWorker(e) {
            const outputPort = await this._jobScheduler._CreateJobWorker();
            return { outputPort: outputPort, transferables: [outputPort] };
        }
        _GetLocalRuntime() {
            if (this._useWorker) throw new Error("not available in worker mode");
            return this._localRuntime;
        }
        PostToRuntimeComponent(
            component,
            handler,
            data,
            dispatchOpts,
            transferables
        ) {
            this._messageChannelPort.postMessage(
                {
                    type: "event",
                    component: component,
                    handler: handler,
                    dispatchOpts: dispatchOpts || null,
                    data: data,
                    responseId: null,
                },
                transferables
            );
        }
        PostToRuntimeComponentAsync(
            component,
            handler,
            data,
            dispatchOpts,
            transferables
        ) {
            const responseId = nextResponseId++;
            const ret = new Promise((resolve, reject) => {
                pendingResponsePromises.set(responseId, { resolve, reject });
            });
            this._messageChannelPort.postMessage(
                {
                    type: "event",
                    component: component,
                    handler: handler,
                    dispatchOpts: dispatchOpts || null,
                    data: data,
                    responseId: responseId,
                },
                transferables
            );
            return ret;
        }
        ["_OnMessageFromRuntime"](data) {
            const type = data["type"];
            if (type === "event") return this._OnEventFromRuntime(data);
            else if (type === "result") this._OnResultFromRuntime(data);
            else if (type === "runtime-ready") this._OnRuntimeReady();
            else if (type === "alert-error") {
                this._RemoveLoadingMessage();
                alert(data["message"]);
            } else if (type === "creating-runtime") this._OnBeforeCreateRuntime();
            else throw new Error(`unknown message '${type}'`);
        }
        _OnEventFromRuntime(e) {
            const component = e["component"];
            const handler = e["handler"];
            const data = e["data"];
            const responseId = e["responseId"];
            const handlerMap = runtimeEventHandlers.get(component);
            if (!handlerMap) {
                console.warn(`[DOM] No event handlers for component '${component}'`);
                return;
            }
            const func = handlerMap.get(handler);
            if (!func) {
                console.warn(
                    `[DOM] No handler '${handler}' for component '${component}'`
                );
                return;
            }
            let ret = null;
            try {
                ret = func(data);
            } catch (err) {
                console.error(`Exception in '${component}' handler '${handler}':`, err);
                if (responseId !== null)
                    this._PostResultToRuntime(responseId, false, "" + err);
                return;
            }
            if (responseId === null) return ret;
            else if (ret && ret.then)
                ret
                    .then((result) => this._PostResultToRuntime(responseId, true, result))
                    .catch((err) => {
                        console.error(
                            `Rejection from '${component}' handler '${handler}':`,
                            err
                        );
                        this._PostResultToRuntime(responseId, false, "" + err);
                    });
            else this._PostResultToRuntime(responseId, true, ret);
        }
        _PostResultToRuntime(responseId, isOk, result) {
            let transferables;
            if (result && result["transferables"])
                transferables = result["transferables"];
            this._messageChannelPort.postMessage(
                { type: "result", responseId: responseId, isOk: isOk, result: result },
                transferables
            );
        }
        _OnResultFromRuntime(data) {
            const responseId = data["responseId"];
            const isOk = data["isOk"];
            const result = data["result"];
            const pendingPromise = pendingResponsePromises.get(responseId);
            if (isOk) pendingPromise.resolve(result);
            else pendingPromise.reject(result);
            pendingResponsePromises.delete(responseId);
        }
        AddRuntimeComponentMessageHandler(component, handler, func) {
            let handlerMap = runtimeEventHandlers.get(component);
            if (!handlerMap) {
                handlerMap = new Map();
                runtimeEventHandlers.set(component, handlerMap);
            }
            if (handlerMap.has(handler))
                throw new Error(
                    `[DOM] Component '${component}' already has handler '${handler}'`
                );
            handlerMap.set(handler, func);
        }
        static AddDOMHandlerClass(Class) {
            if (domHandlerClasses.includes(Class))
                throw new Error("DOM handler already added");
            domHandlerClasses.push(Class);
        }
        _FindRuntimeDOMHandler() {
            for (const dh of this._domHandlers)
                if (dh.GetComponentID() === "runtime") {
                    this._runtimeDomHandler = dh;
                    return;
                }
            throw new Error("cannot find runtime DOM handler");
        }
        _OnMessageFromDebugger(e) {
            this.PostToRuntimeComponent("debugger", "message", e);
        }
        _OnRuntimeReady() {
            for (const h of this._domHandlers) h.Attach();
        }
        static IsDocumentFullscreen() {
            return !!(
                document["fullscreenElement"] ||
                document["webkitFullscreenElement"] ||
                document["mozFullScreenElement"]
            );
        }
        async GetRemotePreviewStatusInfo() {
            return await this.PostToRuntimeComponentAsync(
                "runtime",
                "get-remote-preview-status-info"
            );
        }
        _AddRAFCallback(f) {
            this._rafCallbacks.push(f);
            this._RequestAnimationFrame();
        }
        _RemoveRAFCallback(f) {
            const i = this._rafCallbacks.indexOf(f);
            if (i === -1) throw new Error("invalid callback");
            this._rafCallbacks.splice(i, 1);
            if (!this._rafCallbacks.length) this._CancelAnimationFrame();
        }
        _RequestAnimationFrame() {
            if (this._rafId === -1 && this._rafCallbacks.length)
                this._rafId = requestAnimationFrame(this._rafFunc);
        }
        _CancelAnimationFrame() {
            if (this._rafId !== -1) {
                cancelAnimationFrame(this._rafId);
                this._rafId = -1;
            }
        }
        _OnRAFCallback() {
            this._rafId = -1;
            for (const f of this._rafCallbacks) f();
            this._RequestAnimationFrame();
        }
        TryPlayMedia(mediaElem) {
            this._runtimeDomHandler.TryPlayMedia(mediaElem);
        }
        RemovePendingPlay(mediaElem) {
            this._runtimeDomHandler.RemovePendingPlay(mediaElem);
        }
        _PlayPendingMedia() {
            this._runtimeDomHandler._PlayPendingMedia();
        }
        SetSilent(s) {
            this._runtimeDomHandler.SetSilent(s);
        }
        IsAudioFormatSupported(typeStr) {
            return !!supportedAudioFormats[typeStr];
        }
        async _WasmDecodeWebMOpus(arrayBuffer) {
            const result = await this.PostToRuntimeComponentAsync(
                "runtime",
                "opus-decode",
                { arrayBuffer: arrayBuffer },
                null,
                [arrayBuffer]
            );
            return new Float32Array(result);
        }
        IsAbsoluteURL(url) {
            return (
                /^(?:[a-z\-]+:)?\/\//.test(url) ||
                url.substr(0, 5) === "data:" ||
                url.substr(0, 5) === "blob:"
            );
        }
        IsRelativeURL(url) {
            return !this.IsAbsoluteURL(url);
        }
        async _MaybeGetCordovaScriptURL(url, type) {
            if (
                this._exportType === "cordova" &&
                type === "module" &&
                (url.startsWith("file:") ||
                    (location.protocol === "file:" && this.IsRelativeURL(url)))
            ) {
                let filename = url;
                if (filename.startsWith(this._baseUrl))
                    filename = filename.substr(this._baseUrl.length);
                const arrayBuffer = await this.CordovaFetchLocalFileAsArrayBuffer(
                    filename
                );
                const blob = new Blob([arrayBuffer], {
                    type: "application/javascript",
                });
                return URL.createObjectURL(blob);
            } else return url;
        }
        async _OnCordovaFetchLocalFile(e) {
            const filename = e["filename"];
            switch (e["as"]) {
                case "text":
                    return await this.CordovaFetchLocalFileAsText(filename);
                case "buffer":
                    return await this.CordovaFetchLocalFileAsArrayBuffer(filename);
                default:
                    throw new Error("unsupported type");
            }
        }
        _GetPermissionAPI() {
            const api =
                window["cordova"] &&
                window["cordova"]["plugins"] &&
                window["cordova"]["plugins"]["permissions"];
            if (typeof api !== "object")
                throw new Error("Permission API is not loaded");
            return api;
        }
        _MapPermissionID(api, permission) {
            const permissionID = api[permission];
            if (typeof permissionID !== "string")
                throw new Error("Invalid permission name");
            return permissionID;
        }
        _HasPermission(id) {
            const api = this._GetPermissionAPI();
            return new Promise((resolve, reject) =>
                api["checkPermission"](
                    this._MapPermissionID(api, id),
                    (status) => resolve(!!status["hasPermission"]),
                    reject
                )
            );
        }
        _RequestPermission(id) {
            const api = this._GetPermissionAPI();
            return new Promise((resolve, reject) =>
                api["requestPermission"](
                    this._MapPermissionID(api, id),
                    (status) => resolve(!!status["hasPermission"]),
                    reject
                )
            );
        }
        async RequestPermissions(permissions) {
            if (this.GetExportType() !== "cordova") return true;
            if (this.IsiOSCordova()) return true;
            for (const id of permissions) {
                const alreadyGranted = await this._HasPermission(id);
                if (alreadyGranted) continue;
                const granted = await this._RequestPermission(id);
                if (granted === false) return false;
            }
            return true;
        }
        async RequirePermissions(...permissions) {
            if ((await this.RequestPermissions(permissions)) === false)
                throw new Error("Permission not granted");
        }
        CordovaFetchLocalFile(filename) {
            const path =
                window["cordova"]["file"]["applicationDirectory"] +
                "www/" +
                filename.toLowerCase();
            return new Promise((resolve, reject) => {
                window["resolveLocalFileSystemURL"](
                    path,
                    (entry) => {
                        entry["file"](resolve, reject);
                    },
                    reject
                );
            });
        }
        async CordovaFetchLocalFileAsText(filename) {
            const file = await this.CordovaFetchLocalFile(filename);
            return await BlobToString(file);
        }
        _CordovaMaybeStartNextArrayBufferRead() {
            if (!queuedArrayBufferReads.length) return;
            if (activeArrayBufferReads >= MAX_ARRAYBUFFER_READS) return;
            activeArrayBufferReads++;
            const job = queuedArrayBufferReads.shift();
            this._CordovaDoFetchLocalFileAsAsArrayBuffer(
                job.filename,
                job.successCallback,
                job.errorCallback
            );
        }
        CordovaFetchLocalFileAsArrayBuffer(filename) {
            return new Promise((resolve, reject) => {
                queuedArrayBufferReads.push({
                    filename: filename,
                    successCallback: (result) => {
                        activeArrayBufferReads--;
                        this._CordovaMaybeStartNextArrayBufferRead();
                        resolve(result);
                    },
                    errorCallback: (err) => {
                        activeArrayBufferReads--;
                        this._CordovaMaybeStartNextArrayBufferRead();
                        reject(err);
                    },
                });
                this._CordovaMaybeStartNextArrayBufferRead();
            });
        }
        async _CordovaDoFetchLocalFileAsAsArrayBuffer(
            filename,
            successCallback,
            errorCallback
        ) {
            try {
                const file = await this.CordovaFetchLocalFile(filename);
                const arrayBuffer = await BlobToArrayBuffer(file);
                successCallback(arrayBuffer);
            } catch (err) {
                errorCallback(err);
            }
        }
        async _ConvertDataUrisToBlobs() {
            const promises = [];
            for (const [filename, data] of Object.entries(this._localFileBlobs))
                promises.push(this._ConvertDataUriToBlobs(filename, data));
            await Promise.all(promises);
        }
        async _ConvertDataUriToBlobs(filename, data) {
            if (typeof data === "object") {
                this._localFileBlobs[filename] = new Blob([data["str"]], {
                    type: data["type"],
                });
                this._localFileStrings[filename] = data["str"];
            } else {
                let blob = await this._FetchDataUri(data);
                if (!blob) blob = this._DataURIToBinaryBlobSync(data);
                this._localFileBlobs[filename] = blob;
            }
        }
        async _FetchDataUri(dataUri) {
            try {
                const response = await fetch(dataUri);
                return await response.blob();
            } catch (err) {
                console.warn(
                    "Failed to fetch a data: URI. Falling back to a slower workaround. This is probably because the Content Security Policy unnecessarily blocked it. Allow data: URIs in your CSP to avoid this.",
                    err
                );
                return null;
            }
        }
        _DataURIToBinaryBlobSync(datauri) {
            const o = this._ParseDataURI(datauri);
            return this._BinaryStringToBlob(o.data, o.mime_type);
        }
        _ParseDataURI(datauri) {
            const comma = datauri.indexOf(",");
            if (comma < 0) throw new URIError("expected comma in data: uri");
            const typepart = datauri.substring(5, comma);
            const datapart = datauri.substring(comma + 1);
            const typearr = typepart.split(";");
            const mimetype = typearr[0] || "";
            const encoding1 = typearr[1];
            const encoding2 = typearr[2];
            let decodeddata;
            if (encoding1 === "base64" || encoding2 === "base64")
                decodeddata = atob(datapart);
            else decodeddata = decodeURIComponent(datapart);
            return { mime_type: mimetype, data: decodeddata };
        }
        _BinaryStringToBlob(binstr, mime_type) {
            let len = binstr.length;
            let len32 = len >> 2;
            let a8 = new Uint8Array(len);
            let a32 = new Uint32Array(a8.buffer, 0, len32);
            let i, j;
            for (i = 0, j = 0; i < len32; ++i)
                a32[i] =
                    binstr.charCodeAt(j++) |
                    (binstr.charCodeAt(j++) << 8) |
                    (binstr.charCodeAt(j++) << 16) |
                    (binstr.charCodeAt(j++) << 24);
            let tailLength = len & 3;
            while (tailLength--) {
                a8[j] = binstr.charCodeAt(j);
                ++j;
            }
            return new Blob([a8], { type: mime_type });
        }
    };
}

("use strict");
{
    const RuntimeInterface = self.RuntimeInterface;
    function IsCompatibilityMouseEvent(e) {
        return (
            (e["sourceCapabilities"] &&
                e["sourceCapabilities"]["firesTouchEvents"]) ||
            (e["originalEvent"] &&
                e["originalEvent"]["sourceCapabilities"] &&
                e["originalEvent"]["sourceCapabilities"]["firesTouchEvents"])
        );
    }
    const KEY_CODE_ALIASES = new Map([
        ["OSLeft", "MetaLeft"],
        ["OSRight", "MetaRight"],
    ]);
    const DISPATCH_RUNTIME_AND_SCRIPT = {
        dispatchRuntimeEvent: true,
        dispatchUserScriptEvent: true,
    };
    const DISPATCH_SCRIPT_ONLY = { dispatchUserScriptEvent: true };
    const DISPATCH_RUNTIME_ONLY = { dispatchRuntimeEvent: true };
    function AddStyleSheet(cssUrl) {
        return new Promise((resolve, reject) => {
            const styleLink = document.createElement("link");
            styleLink.onload = () => resolve(styleLink);
            styleLink.onerror = (err) => reject(err);
            styleLink.rel = "stylesheet";
            styleLink.href = cssUrl;
            document.head.appendChild(styleLink);
        });
    }
    function FetchImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = (err) => reject(err);
            img.src = url;
        });
    }
    async function BlobToImage(blob) {
        const blobUrl = URL.createObjectURL(blob);
        try {
            return await FetchImage(blobUrl);
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
    }
    function BlobToString(blob) {
        return new Promise((resolve, reject) => {
            let fileReader = new FileReader();
            fileReader.onload = (e) => resolve(e.target.result);
            fileReader.onerror = (err) => reject(err);
            fileReader.readAsText(blob);
        });
    }
    async function BlobToSvgImage(blob, width, height) {
        if (!/firefox/i.test(navigator.userAgent)) return await BlobToImage(blob);
        let str = await BlobToString(blob);
        const parser = new DOMParser();
        const doc = parser.parseFromString(str, "image/svg+xml");
        const rootElem = doc.documentElement;
        if (rootElem.hasAttribute("width") && rootElem.hasAttribute("height")) {
            const widthStr = rootElem.getAttribute("width");
            const heightStr = rootElem.getAttribute("height");
            if (!widthStr.includes("%") && !heightStr.includes("%"))
                return await BlobToImage(blob);
        }
        rootElem.setAttribute("width", width + "px");
        rootElem.setAttribute("height", height + "px");
        const serializer = new XMLSerializer();
        str = serializer.serializeToString(doc);
        blob = new Blob([str], { type: "image/svg+xml" });
        return await BlobToImage(blob);
    }
    function IsInContentEditable(el) {
        do {
            if (el.parentNode && el.hasAttribute("contenteditable")) return true;
            el = el.parentNode;
        } while (el);
        return false;
    }
    const canvasOrDocTags = new Set(["canvas", "body", "html"]);
    function PreventDefaultOnCanvasOrDoc(e) {
        const tagName = e.target.tagName.toLowerCase();
        if (canvasOrDocTags.has(tagName)) e.preventDefault();
    }
    function BlockWheelZoom(e) {
        if (e.metaKey || e.ctrlKey) e.preventDefault();
    }
    self["C3_GetSvgImageSize"] = async function (blob) {
        const img = await BlobToImage(blob);
        if (img.width > 0 && img.height > 0) return [img.width, img.height];
        else {
            img.style.position = "absolute";
            img.style.left = "0px";
            img.style.top = "0px";
            img.style.visibility = "hidden";
            document.body.appendChild(img);
            const rc = img.getBoundingClientRect();
            document.body.removeChild(img);
            return [rc.width, rc.height];
        }
    };
    self["C3_RasterSvgImageBlob"] = async function (
        blob,
        imageWidth,
        imageHeight,
        surfaceWidth,
        surfaceHeight
    ) {
        const img = await BlobToSvgImage(blob, imageWidth, imageHeight);
        const canvas = document.createElement("canvas");
        canvas.width = surfaceWidth;
        canvas.height = surfaceHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, imageWidth, imageHeight);
        return canvas;
    };
    let isCordovaPaused = false;
    document.addEventListener("pause", () => (isCordovaPaused = true));
    document.addEventListener("resume", () => (isCordovaPaused = false));
    function ParentHasFocus() {
        try {
            return window.parent && window.parent.document.hasFocus();
        } catch (err) {
            return false;
        }
    }
    function KeyboardIsVisible() {
        const elem = document.activeElement;
        if (!elem) return false;
        const tagName = elem.tagName.toLowerCase();
        const inputTypes = new Set([
            "email",
            "number",
            "password",
            "search",
            "tel",
            "text",
            "url",
        ]);
        if (tagName === "textarea") return true;
        if (tagName === "input")
            return inputTypes.has(elem.type.toLowerCase() || "text");
        return IsInContentEditable(elem);
    }
    const DOM_COMPONENT_ID = "runtime";
    const HANDLER_CLASS = class RuntimeDOMHandler extends self.DOMHandler {
        constructor(iRuntime) {
            super(iRuntime, DOM_COMPONENT_ID);
            this._isFirstSizeUpdate = true;
            this._simulatedResizeTimerId = -1;
            this._targetOrientation = "any";
            this._attachedDeviceOrientationEvent = false;
            this._attachedDeviceMotionEvent = false;
            this._debugHighlightElem = null;
            this._pointerRawUpdateRateLimiter = null;
            this._lastPointerRawUpdateEvent = null;
            iRuntime.AddRuntimeComponentMessageHandler("canvas", "update-size", (e) =>
                this._OnUpdateCanvasSize(e)
            );
            iRuntime.AddRuntimeComponentMessageHandler(
                "runtime",
                "invoke-download",
                (e) => this._OnInvokeDownload(e)
            );
            iRuntime.AddRuntimeComponentMessageHandler(
                "runtime",
                "raster-svg-image",
                (e) => this._OnRasterSvgImage(e)
            );
            iRuntime.AddRuntimeComponentMessageHandler(
                "runtime",
                "get-svg-image-size",
                (e) => this._OnGetSvgImageSize(e)
            );
            iRuntime.AddRuntimeComponentMessageHandler(
                "runtime",
                "set-target-orientation",
                (e) => this._OnSetTargetOrientation(e)
            );
            iRuntime.AddRuntimeComponentMessageHandler("runtime", "register-sw", () =>
                this._OnRegisterSW()
            );
            iRuntime.AddRuntimeComponentMessageHandler(
                "runtime",
                "post-to-debugger",
                (e) => this._OnPostToDebugger(e)
            );
            iRuntime.AddRuntimeComponentMessageHandler(
                "runtime",
                "go-to-script",
                (e) => this._OnPostToDebugger(e)
            );
            iRuntime.AddRuntimeComponentMessageHandler(
                "runtime",
                "before-start-ticking",
                () => this._OnBeforeStartTicking()
            );
            iRuntime.AddRuntimeComponentMessageHandler(
                "runtime",
                "debug-highlight",
                (e) => this._OnDebugHighlight(e)
            );
            iRuntime.AddRuntimeComponentMessageHandler(
                "runtime",
                "enable-device-orientation",
                () => this._AttachDeviceOrientationEvent()
            );
            iRuntime.AddRuntimeComponentMessageHandler(
                "runtime",
                "enable-device-motion",
                () => this._AttachDeviceMotionEvent()
            );
            iRuntime.AddRuntimeComponentMessageHandler(
                "runtime",
                "add-stylesheet",
                (e) => this._OnAddStylesheet(e)
            );
            iRuntime.AddRuntimeComponentMessageHandler("runtime", "alert", (e) =>
                this._OnAlert(e)
            );
            iRuntime.AddRuntimeComponentMessageHandler(
                "runtime",
                "hide-cordova-splash",
                () => this._OnHideCordovaSplash()
            );
            const allowDefaultContextMenuTagNames = new Set([
                "input",
                "textarea",
                "datalist",
            ]);
            window.addEventListener("contextmenu", (e) => {
                const t = e.target;
                const name = t.tagName.toLowerCase();
                if (
                    !allowDefaultContextMenuTagNames.has(name) &&
                    !IsInContentEditable(t)
                )
                    e.preventDefault();
            });
            const canvas = iRuntime.GetCanvas();
            window.addEventListener("selectstart", PreventDefaultOnCanvasOrDoc);
            window.addEventListener("gesturehold", PreventDefaultOnCanvasOrDoc);
            canvas.addEventListener("selectstart", PreventDefaultOnCanvasOrDoc);
            canvas.addEventListener("gesturehold", PreventDefaultOnCanvasOrDoc);
            window.addEventListener("touchstart", PreventDefaultOnCanvasOrDoc, {
                passive: false,
            });
            if (typeof PointerEvent !== "undefined") {
                window.addEventListener("pointerdown", PreventDefaultOnCanvasOrDoc, {
                    passive: false,
                });
                canvas.addEventListener("pointerdown", PreventDefaultOnCanvasOrDoc);
            } else canvas.addEventListener("touchstart", PreventDefaultOnCanvasOrDoc);
            this._mousePointerLastButtons = 0;
            window.addEventListener("mousedown", (e) => {
                if (e.button === 1) e.preventDefault();
            });
            window.addEventListener("mousewheel", BlockWheelZoom, { passive: false });
            window.addEventListener("wheel", BlockWheelZoom, { passive: false });
            window.addEventListener("resize", () => this._OnWindowResize());
            window.addEventListener("fullscreenchange", () =>
                this._OnFullscreenChange()
            );
            window.addEventListener("webkitfullscreenchange", () =>
                this._OnFullscreenChange()
            );
            window.addEventListener("mozfullscreenchange", () =>
                this._OnFullscreenChange()
            );
            window.addEventListener("fullscreenerror", (e) =>
                this._OnFullscreenError(e)
            );
            window.addEventListener("webkitfullscreenerror", (e) =>
                this._OnFullscreenError(e)
            );
            window.addEventListener("mozfullscreenerror", (e) =>
                this._OnFullscreenError(e)
            );
            if (iRuntime.IsiOSWebView())
                window.addEventListener("focusout", () => {
                    if (!KeyboardIsVisible()) document.scrollingElement.scrollTop = 0;
                });
            this._mediaPendingPlay = new Set();
            this._mediaRemovedPendingPlay = new WeakSet();
            this._isSilent = false;
        }
        _OnBeforeStartTicking() {
            if (this._iRuntime.GetExportType() === "cordova") {
                document.addEventListener("pause", () =>
                    this._OnVisibilityChange(true)
                );
                document.addEventListener("resume", () =>
                    this._OnVisibilityChange(false)
                );
            } else
                document.addEventListener("visibilitychange", () =>
                    this._OnVisibilityChange(document.hidden)
                );
            return { isSuspended: !!(document.hidden || isCordovaPaused) };
        }
        Attach() {
            window.addEventListener("focus", () =>
                this._PostRuntimeEvent("window-focus")
            );
            window.addEventListener("blur", () => {
                this._PostRuntimeEvent("window-blur", {
                    parentHasFocus: ParentHasFocus(),
                });
                this._mousePointerLastButtons = 0;
            });
            window.addEventListener("keydown", (e) => this._OnKeyEvent("keydown", e));
            window.addEventListener("keyup", (e) => this._OnKeyEvent("keyup", e));
            window.addEventListener("dblclick", (e) =>
                this._OnMouseEvent("dblclick", e, DISPATCH_RUNTIME_AND_SCRIPT)
            );
            window.addEventListener("wheel", (e) =>
                this._OnMouseWheelEvent("wheel", e)
            );
            if (typeof PointerEvent !== "undefined") {
                window.addEventListener("pointerdown", (e) => {
                    this._HandlePointerDownFocus(e);
                    this._OnPointerEvent("pointerdown", e);
                });
                if (
                    this._iRuntime.UsesWorker() &&
                    typeof window["onpointerrawupdate"] !== "undefined" &&
                    self === self.top
                ) {
                    this._pointerRawUpdateRateLimiter = new self.RateLimiter(
                        () => this._DoSendPointerRawUpdate(),
                        5
                    );
                    this._pointerRawUpdateRateLimiter.SetCanRunImmediate(true);
                    window.addEventListener("pointerrawupdate", (e) =>
                        this._OnPointerRawUpdate(e)
                    );
                } else
                    window.addEventListener("pointermove", (e) =>
                        this._OnPointerEvent("pointermove", e)
                    );
                window.addEventListener("pointerup", (e) =>
                    this._OnPointerEvent("pointerup", e)
                );
                window.addEventListener("pointercancel", (e) =>
                    this._OnPointerEvent("pointercancel", e)
                );
            } else {
                window.addEventListener("mousedown", (e) => {
                    this._HandlePointerDownFocus(e);
                    this._OnMouseEventAsPointer("pointerdown", e);
                });
                window.addEventListener("mousemove", (e) =>
                    this._OnMouseEventAsPointer("pointermove", e)
                );
                window.addEventListener("mouseup", (e) =>
                    this._OnMouseEventAsPointer("pointerup", e)
                );
                window.addEventListener("touchstart", (e) => {
                    this._HandlePointerDownFocus(e);
                    this._OnTouchEvent("pointerdown", e);
                });
                window.addEventListener("touchmove", (e) =>
                    this._OnTouchEvent("pointermove", e)
                );
                window.addEventListener("touchend", (e) =>
                    this._OnTouchEvent("pointerup", e)
                );
                window.addEventListener("touchcancel", (e) =>
                    this._OnTouchEvent("pointercancel", e)
                );
            }
            const playFunc = () => this._PlayPendingMedia();
            window.addEventListener("pointerup", playFunc, true);
            window.addEventListener("touchend", playFunc, true);
            window.addEventListener("click", playFunc, true);
            window.addEventListener("keydown", playFunc, true);
            window.addEventListener("gamepadconnected", playFunc, true);
        }
        _PostRuntimeEvent(name, data) {
            this.PostToRuntime(name, data || null, DISPATCH_RUNTIME_ONLY);
        }
        _GetWindowInnerWidth() {
            return this._iRuntime._GetWindowInnerWidth();
        }
        _GetWindowInnerHeight() {
            return this._iRuntime._GetWindowInnerHeight();
        }
        _OnWindowResize() {
            const width = this._GetWindowInnerWidth();
            const height = this._GetWindowInnerHeight();
            this._PostRuntimeEvent("window-resize", {
                innerWidth: width,
                innerHeight: height,
                devicePixelRatio: window.devicePixelRatio,
            });
            if (this._iRuntime.IsiOSWebView()) {
                if (this._simulatedResizeTimerId !== -1)
                    clearTimeout(this._simulatedResizeTimerId);
                this._OnSimulatedResize(width, height, 0);
            }
        }
        _ScheduleSimulatedResize(width, height, count) {
            if (this._simulatedResizeTimerId !== -1)
                clearTimeout(this._simulatedResizeTimerId);
            this._simulatedResizeTimerId = setTimeout(
                () => this._OnSimulatedResize(width, height, count),
                48
            );
        }
        _OnSimulatedResize(originalWidth, originalHeight, count) {
            const width = this._GetWindowInnerWidth();
            const height = this._GetWindowInnerHeight();
            this._simulatedResizeTimerId = -1;
            if (width != originalWidth || height != originalHeight)
                this._PostRuntimeEvent("window-resize", {
                    innerWidth: width,
                    innerHeight: height,
                    devicePixelRatio: window.devicePixelRatio,
                });
            else if (count < 10)
                this._ScheduleSimulatedResize(width, height, count + 1);
        }
        _OnSetTargetOrientation(e) {
            this._targetOrientation = e["targetOrientation"];
        }
        _TrySetTargetOrientation() {
            const orientation = this._targetOrientation;
            if (screen["orientation"] && screen["orientation"]["lock"])
                screen["orientation"]
                    ["lock"](orientation)
                    .catch((err) =>
                        console.warn("[Construct 3] Failed to lock orientation: ", err)
                    );
            else
                try {
                    let result = false;
                    if (screen["lockOrientation"])
                        result = screen["lockOrientation"](orientation);
                    else if (screen["webkitLockOrientation"])
                        result = screen["webkitLockOrientation"](orientation);
                    else if (screen["mozLockOrientation"])
                        result = screen["mozLockOrientation"](orientation);
                    else if (screen["msLockOrientation"])
                        result = screen["msLockOrientation"](orientation);
                    if (!result) console.warn("[Construct 3] Failed to lock orientation");
                } catch (err) {
                    console.warn("[Construct 3] Failed to lock orientation: ", err);
                }
        }
        _OnFullscreenChange() {
            const isDocFullscreen = RuntimeInterface.IsDocumentFullscreen();
            if (isDocFullscreen && this._targetOrientation !== "any")
                this._TrySetTargetOrientation();
            this.PostToRuntime("fullscreenchange", {
                isFullscreen: isDocFullscreen,
                innerWidth: this._GetWindowInnerWidth(),
                innerHeight: this._GetWindowInnerHeight(),
            });
        }
        _OnFullscreenError(e) {
            console.warn("[Construct 3] Fullscreen request failed: ", e);
            this.PostToRuntime("fullscreenerror", {
                isFullscreen: RuntimeInterface.IsDocumentFullscreen(),
                innerWidth: this._GetWindowInnerWidth(),
                innerHeight: this._GetWindowInnerHeight(),
            });
        }
        _OnVisibilityChange(isHidden) {
            if (isHidden) this._iRuntime._CancelAnimationFrame();
            else this._iRuntime._RequestAnimationFrame();
            this.PostToRuntime("visibilitychange", { hidden: isHidden });
        }
        _OnKeyEvent(name, e) {
            if (e.key === "Backspace") PreventDefaultOnCanvasOrDoc(e);
            const code = KEY_CODE_ALIASES.get(e.code) || e.code;
            this._PostToRuntimeMaybeSync(
                name,
                {
                    code: code,
                    key: e.key,
                    which: e.which,
                    repeat: e.repeat,
                    altKey: e.altKey,
                    ctrlKey: e.ctrlKey,
                    metaKey: e.metaKey,
                    shiftKey: e.shiftKey,
                    timeStamp: e.timeStamp,
                },
                DISPATCH_RUNTIME_AND_SCRIPT
            );
        }
        _OnMouseWheelEvent(name, e) {
            this.PostToRuntime(
                name,
                {
                    clientX: e.clientX,
                    clientY: e.clientY,
                    pageX: e.pageX,
                    pageY: e.pageY,
                    deltaX: e.deltaX,
                    deltaY: e.deltaY,
                    deltaZ: e.deltaZ,
                    deltaMode: e.deltaMode,
                    timeStamp: e.timeStamp,
                },
                DISPATCH_RUNTIME_AND_SCRIPT
            );
        }
        _OnMouseEvent(name, e, opts) {
            if (IsCompatibilityMouseEvent(e)) return;
            this._PostToRuntimeMaybeSync(
                name,
                {
                    button: e.button,
                    buttons: e.buttons,
                    clientX: e.clientX,
                    clientY: e.clientY,
                    pageX: e.pageX,
                    pageY: e.pageY,
                    timeStamp: e.timeStamp,
                },
                opts
            );
        }
        _OnMouseEventAsPointer(name, e) {
            if (IsCompatibilityMouseEvent(e)) return;
            const pointerId = 1;
            const lastButtons = this._mousePointerLastButtons;
            if (name === "pointerdown" && lastButtons !== 0) name = "pointermove";
            else if (name === "pointerup" && e.buttons !== 0) name = "pointermove";
            this._PostToRuntimeMaybeSync(
                name,
                {
                    pointerId: pointerId,
                    pointerType: "mouse",
                    button: e.button,
                    buttons: e.buttons,
                    lastButtons: lastButtons,
                    clientX: e.clientX,
                    clientY: e.clientY,
                    pageX: e.pageX,
                    pageY: e.pageY,
                    width: 0,
                    height: 0,
                    pressure: 0,
                    tangentialPressure: 0,
                    tiltX: 0,
                    tiltY: 0,
                    twist: 0,
                    timeStamp: e.timeStamp,
                },
                DISPATCH_RUNTIME_AND_SCRIPT
            );
            this._mousePointerLastButtons = e.buttons;
            this._OnMouseEvent(e.type, e, DISPATCH_SCRIPT_ONLY);
        }
        _OnPointerEvent(name, e) {
            if (this._pointerRawUpdateRateLimiter && name !== "pointermove")
                this._pointerRawUpdateRateLimiter.Reset();
            let lastButtons = 0;
            if (e.pointerType === "mouse")
                lastButtons = this._mousePointerLastButtons;
            this._PostToRuntimeMaybeSync(
                name,
                {
                    pointerId: e.pointerId,
                    pointerType: e.pointerType,
                    button: e.button,
                    buttons: e.buttons,
                    lastButtons: lastButtons,
                    clientX: e.clientX,
                    clientY: e.clientY,
                    pageX: e.pageX,
                    pageY: e.pageY,
                    width: e.width || 0,
                    height: e.height || 0,
                    pressure: e.pressure || 0,
                    tangentialPressure: e["tangentialPressure"] || 0,
                    tiltX: e.tiltX || 0,
                    tiltY: e.tiltY || 0,
                    twist: e["twist"] || 0,
                    timeStamp: e.timeStamp,
                },
                DISPATCH_RUNTIME_AND_SCRIPT
            );
            if (e.pointerType === "mouse") {
                let mouseEventName = "mousemove";
                if (name === "pointerdown") mouseEventName = "mousedown";
                else if (name === "pointerup") mouseEventName = "mouseup";
                this._OnMouseEvent(mouseEventName, e, DISPATCH_SCRIPT_ONLY);
                this._mousePointerLastButtons = e.buttons;
            }
        }
        _OnPointerRawUpdate(e) {
            this._lastPointerRawUpdateEvent = e;
            this._pointerRawUpdateRateLimiter.Call();
        }
        _DoSendPointerRawUpdate() {
            this._OnPointerEvent("pointermove", this._lastPointerRawUpdateEvent);
            this._lastPointerRawUpdateEvent = null;
        }
        _OnTouchEvent(fireName, e) {
            for (let i = 0, len = e.changedTouches.length; i < len; ++i) {
                const t = e.changedTouches[i];
                this._PostToRuntimeMaybeSync(
                    fireName,
                    {
                        pointerId: t.identifier,
                        pointerType: "touch",
                        button: 0,
                        buttons: 0,
                        lastButtons: 0,
                        clientX: t.clientX,
                        clientY: t.clientY,
                        pageX: t.pageX,
                        pageY: t.pageY,
                        width: (t["radiusX"] || t["webkitRadiusX"] || 0) * 2,
                        height: (t["radiusY"] || t["webkitRadiusY"] || 0) * 2,
                        pressure: t["force"] || t["webkitForce"] || 0,
                        tangentialPressure: 0,
                        tiltX: 0,
                        tiltY: 0,
                        twist: t["rotationAngle"] || 0,
                        timeStamp: e.timeStamp,
                    },
                    DISPATCH_RUNTIME_AND_SCRIPT
                );
            }
        }
        _HandlePointerDownFocus(e) {
            if (window !== window.top) window.focus();
            if (
                this._IsElementCanvasOrDocument(e.target) &&
                document.activeElement &&
                !this._IsElementCanvasOrDocument(document.activeElement)
            )
                document.activeElement.blur();
        }
        _IsElementCanvasOrDocument(elem) {
            return (
                !elem ||
                elem === document ||
                elem === window ||
                elem === document.body ||
                elem.tagName.toLowerCase() === "canvas"
            );
        }
        _AttachDeviceOrientationEvent() {
            if (this._attachedDeviceOrientationEvent) return;
            this._attachedDeviceOrientationEvent = true;
            window.addEventListener("deviceorientation", (e) =>
                this._OnDeviceOrientation(e)
            );
            window.addEventListener("deviceorientationabsolute", (e) =>
                this._OnDeviceOrientationAbsolute(e)
            );
        }
        _AttachDeviceMotionEvent() {
            if (this._attachedDeviceMotionEvent) return;
            this._attachedDeviceMotionEvent = true;
            window.addEventListener("devicemotion", (e) => this._OnDeviceMotion(e));
        }
        _OnDeviceOrientation(e) {
            this.PostToRuntime(
                "deviceorientation",
                {
                    absolute: !!e["absolute"],
                    alpha: e["alpha"] || 0,
                    beta: e["beta"] || 0,
                    gamma: e["gamma"] || 0,
                    timeStamp: e.timeStamp,
                    webkitCompassHeading: e["webkitCompassHeading"],
                    webkitCompassAccuracy: e["webkitCompassAccuracy"],
                },
                DISPATCH_RUNTIME_AND_SCRIPT
            );
        }
        _OnDeviceOrientationAbsolute(e) {
            this.PostToRuntime(
                "deviceorientationabsolute",
                {
                    absolute: !!e["absolute"],
                    alpha: e["alpha"] || 0,
                    beta: e["beta"] || 0,
                    gamma: e["gamma"] || 0,
                    timeStamp: e.timeStamp,
                },
                DISPATCH_RUNTIME_AND_SCRIPT
            );
        }
        _OnDeviceMotion(e) {
            let accProp = null;
            const acc = e["acceleration"];
            if (acc)
                accProp = { x: acc["x"] || 0, y: acc["y"] || 0, z: acc["z"] || 0 };
            let withGProp = null;
            const withG = e["accelerationIncludingGravity"];
            if (withG)
                withGProp = {
                    x: withG["x"] || 0,
                    y: withG["y"] || 0,
                    z: withG["z"] || 0,
                };
            let rotationRateProp = null;
            const rotationRate = e["rotationRate"];
            if (rotationRate)
                rotationRateProp = {
                    alpha: rotationRate["alpha"] || 0,
                    beta: rotationRate["beta"] || 0,
                    gamma: rotationRate["gamma"] || 0,
                };
            this.PostToRuntime(
                "devicemotion",
                {
                    acceleration: accProp,
                    accelerationIncludingGravity: withGProp,
                    rotationRate: rotationRateProp,
                    interval: e["interval"],
                    timeStamp: e.timeStamp,
                },
                DISPATCH_RUNTIME_AND_SCRIPT
            );
        }
        _OnUpdateCanvasSize(e) {
            const runtimeInterface = this.GetRuntimeInterface();
            const canvas = runtimeInterface.GetCanvas();
            canvas.style.width = e["styleWidth"] + "px";
            canvas.style.height = e["styleHeight"] + "px";
            canvas.style.marginLeft = e["marginLeft"] + "px";
            canvas.style.marginTop = e["marginTop"] + "px";
            if (this._isFirstSizeUpdate) {
                canvas.style.display = "";
                this._isFirstSizeUpdate = false;
            }
        }
        _OnInvokeDownload(e) {
            const url = e["url"];
            const filename = e["filename"];
            const a = document.createElement("a");
            const body = document.body;
            a.textContent = filename;
            a.href = url;
            a.download = filename;
            body.appendChild(a);
            a.click();
            body.removeChild(a);
        }
        async _OnRasterSvgImage(e) {
            const blob = e["blob"];
            const imageWidth = e["imageWidth"];
            const imageHeight = e["imageHeight"];
            const surfaceWidth = e["surfaceWidth"];
            const surfaceHeight = e["surfaceHeight"];
            const imageBitmapOpts = e["imageBitmapOpts"];
            const canvas = await self["C3_RasterSvgImageBlob"](
                blob,
                imageWidth,
                imageHeight,
                surfaceWidth,
                surfaceHeight
            );
            let ret;
            if (imageBitmapOpts)
                ret = await createImageBitmap(canvas, imageBitmapOpts);
            else ret = await createImageBitmap(canvas);
            return { imageBitmap: ret, transferables: [ret] };
        }
        async _OnGetSvgImageSize(e) {
            return await self["C3_GetSvgImageSize"](e["blob"]);
        }
        async _OnAddStylesheet(e) {
            await AddStyleSheet(e["url"]);
        }
        _PlayPendingMedia() {
            const mediaToTryPlay = [...this._mediaPendingPlay];
            this._mediaPendingPlay.clear();
            if (!this._isSilent)
                for (const mediaElem of mediaToTryPlay) {
                    const playRet = mediaElem.play();
                    if (playRet)
                        playRet.catch((err) => {
                            if (!this._mediaRemovedPendingPlay.has(mediaElem))
                                this._mediaPendingPlay.add(mediaElem);
                        });
                }
        }
        TryPlayMedia(mediaElem) {
            if (typeof mediaElem.play !== "function")
                throw new Error("missing play function");
            this._mediaRemovedPendingPlay.delete(mediaElem);
            let playRet;
            try {
                playRet = mediaElem.play();
            } catch (err) {
                this._mediaPendingPlay.add(mediaElem);
                return;
            }
            if (playRet)
                playRet.catch((err) => {
                    if (!this._mediaRemovedPendingPlay.has(mediaElem))
                        this._mediaPendingPlay.add(mediaElem);
                });
        }
        RemovePendingPlay(mediaElem) {
            this._mediaPendingPlay.delete(mediaElem);
            this._mediaRemovedPendingPlay.add(mediaElem);
        }
        SetSilent(s) {
            this._isSilent = !!s;
        }
        _OnHideCordovaSplash() {
            if (navigator["splashscreen"] && navigator["splashscreen"]["hide"])
                navigator["splashscreen"]["hide"]();
        }
        _OnDebugHighlight(e) {
            const show = e["show"];
            if (!show) {
                if (this._debugHighlightElem)
                    this._debugHighlightElem.style.display = "none";
                return;
            }
            if (!this._debugHighlightElem) {
                this._debugHighlightElem = document.createElement("div");
                this._debugHighlightElem.id = "inspectOutline";
                document.body.appendChild(this._debugHighlightElem);
            }
            const elem = this._debugHighlightElem;
            elem.style.display = "";
            elem.style.left = e["left"] - 1 + "px";
            elem.style.top = e["top"] - 1 + "px";
            elem.style.width = e["width"] + 2 + "px";
            elem.style.height = e["height"] + 2 + "px";
            elem.textContent = e["name"];
        }
        _OnRegisterSW() {
            if (window["C3_RegisterSW"]) window["C3_RegisterSW"]();
        }
        _OnPostToDebugger(data) {
            if (!window["c3_postToMessagePort"]) return;
            data["from"] = "runtime";
            window["c3_postToMessagePort"](data);
        }
        _InvokeFunctionFromJS(name, params) {
            return this.PostToRuntimeAsync("js-invoke-function", {
                name: name,
                params: params,
            });
        }
        _OnAlert(e) {
            alert(e["message"]);
        }
    };
    RuntimeInterface.AddDOMHandlerClass(HANDLER_CLASS);
}

("use strict");
{
    const DISPATCH_WORKER_SCRIPT_NAME = "dispatchworker.js";
    const JOB_WORKER_SCRIPT_NAME = "jobworker.js";
    self.JobSchedulerDOM = class JobSchedulerDOM {
        constructor(runtimeInterface) {
            this._runtimeInterface = runtimeInterface;
            this._baseUrl = runtimeInterface.GetBaseURL();
            if (runtimeInterface.GetExportType() === "preview")
                this._baseUrl += "c3/workers/";
            else this._baseUrl += runtimeInterface.GetScriptFolder();
            this._maxNumWorkers = Math.min(navigator.hardwareConcurrency || 2, 16);
            this._dispatchWorker = null;
            this._jobWorkers = [];
            this._inputPort = null;
            this._outputPort = null;
        }
        async Init() {
            if (this._hasInitialised) throw new Error("already initialised");
            this._hasInitialised = true;
            const dispatchWorkerScriptUrl = this._runtimeInterface._GetWorkerURL(
                DISPATCH_WORKER_SCRIPT_NAME
            );
            this._dispatchWorker = await this._runtimeInterface.CreateWorker(
                dispatchWorkerScriptUrl,
                this._baseUrl,
                { name: "DispatchWorker" }
            );
            const messageChannel = new MessageChannel();
            this._inputPort = messageChannel.port1;
            this._dispatchWorker.postMessage(
                { type: "_init", "in-port": messageChannel.port2 },
                [messageChannel.port2]
            );
            this._outputPort = await this._CreateJobWorker();
        }
        async _CreateJobWorker() {
            const number = this._jobWorkers.length;
            const jobWorkerScriptUrl = this._runtimeInterface._GetWorkerURL(
                JOB_WORKER_SCRIPT_NAME
            );
            const jobWorker = await this._runtimeInterface.CreateWorker(
                jobWorkerScriptUrl,
                this._baseUrl,
                { name: "JobWorker" + number }
            );
            const dispatchChannel = new MessageChannel();
            const outputChannel = new MessageChannel();
            this._dispatchWorker.postMessage(
                { type: "_addJobWorker", port: dispatchChannel.port1 },
                [dispatchChannel.port1]
            );
            jobWorker.postMessage(
                {
                    type: "init",
                    number: number,
                    "dispatch-port": dispatchChannel.port2,
                    "output-port": outputChannel.port2,
                },
                [dispatchChannel.port2, outputChannel.port2]
            );
            this._jobWorkers.push(jobWorker);
            return outputChannel.port1;
        }
        GetPortData() {
            return {
                inputPort: this._inputPort,
                outputPort: this._outputPort,
                maxNumWorkers: this._maxNumWorkers,
            };
        }
        GetPortTransferables() {
            return [this._inputPort, this._outputPort];
        }
    };
}

("use strict");
{
    if (window["C3_IsSupported"]) {
        const enableWorker = false;
        window["c3_runtimeInterface"] = new self.RuntimeInterface({
            useWorker: enableWorker,
            workerMainUrl: "workermain.js",
            engineScripts: ["scripts/c3runtime.js"],
            projectScripts: [],
            mainProjectScript: "",
            scriptsType: "module",
            scriptFolder: "scripts/",
            workerDependencyScripts: [],
            exportType: "html5",
        });
    }
}
("use strict");
{
    const DOM_COMPONENT_ID = "browser";
    const HANDLER_CLASS = class BrowserDOMHandler extends self.DOMHandler {
        constructor(iRuntime) {
            super(iRuntime, DOM_COMPONENT_ID);
            this._exportType = "";
            this.AddRuntimeMessageHandlers([
                ["get-initial-state", (e) => this._OnGetInitialState(e)],
                ["ready-for-sw-messages", () => this._OnReadyForSWMessages()],
                ["alert", (e) => this._OnAlert(e)],
                ["close", () => this._OnClose()],
                ["set-focus", (e) => this._OnSetFocus(e)],
                ["vibrate", (e) => this._OnVibrate(e)],
                ["lock-orientation", (e) => this._OnLockOrientation(e)],
                ["unlock-orientation", () => this._OnUnlockOrientation()],
                ["navigate", (e) => this._OnNavigate(e)],
                ["request-fullscreen", (e) => this._OnRequestFullscreen(e)],
                ["exit-fullscreen", () => this._OnExitFullscreen()],
                ["set-hash", (e) => this._OnSetHash(e)],
            ]);
            window.addEventListener("online", () => this._OnOnlineStateChanged(true));
            window.addEventListener("offline", () =>
                this._OnOnlineStateChanged(false)
            );
            window.addEventListener("hashchange", () => this._OnHashChange());
            document.addEventListener("backbutton", () =>
                this._OnCordovaBackButton()
            );
            if (typeof Windows !== "undefined")
                Windows["UI"]["Core"]["SystemNavigationManager"]
                    ["getForCurrentView"]()
                    .addEventListener("backrequested", (e) =>
                        this._OnWin10BackRequested(e)
                    );
        }
        _OnGetInitialState(e) {
            this._exportType = e["exportType"];
            return {
                location: location.toString(),
                isOnline: !!navigator.onLine,
                referrer: document.referrer,
                title: document.title,
                isCookieEnabled: !!navigator.cookieEnabled,
                screenWidth: screen.width,
                screenHeight: screen.height,
                windowOuterWidth: window.outerWidth,
                windowOuterHeight: window.outerHeight,
                isScirraArcade: typeof window["is_scirra_arcade"] !== "undefined",
            };
        }
        _OnReadyForSWMessages() {
            if (!window["C3_RegisterSW"] || !window["OfflineClientInfo"]) return;
            window["OfflineClientInfo"]["SetMessageCallback"]((e) =>
                this.PostToRuntime("sw-message", e["data"])
            );
        }
        _OnOnlineStateChanged(isOnline) {
            this.PostToRuntime("online-state", { isOnline: isOnline });
        }
        _OnCordovaBackButton() {
            this.PostToRuntime("backbutton");
        }
        _OnWin10BackRequested(e) {
            e["handled"] = true;
            this.PostToRuntime("backbutton");
        }
        GetNWjsWindow() {
            if (this._exportType === "nwjs") return nw["Window"]["get"]();
            else return null;
        }
        _OnAlert(e) {
            alert(e["message"]);
        }
        _OnClose() {
            if (navigator["app"] && navigator["app"]["exitApp"])
                navigator["app"]["exitApp"]();
            else if (navigator["device"] && navigator["device"]["exitApp"])
                navigator["device"]["exitApp"]();
            else window.close();
        }
        _OnSetFocus(e) {
            const isFocus = e["isFocus"];
            if (this._exportType === "nwjs") {
                const win = this.GetNWjsWindow();
                if (isFocus) win["focus"]();
                else win["blur"]();
            } else if (isFocus) window.focus();
            else window.blur();
        }
        _OnVibrate(e) {
            if (navigator["vibrate"]) navigator["vibrate"](e["pattern"]);
        }
        _OnLockOrientation(e) {
            const orientation = e["orientation"];
            if (screen["orientation"] && screen["orientation"]["lock"])
                screen["orientation"]
                    ["lock"](orientation)
                    .catch((err) =>
                        console.warn("[Construct 3] Failed to lock orientation: ", err)
                    );
            else
                try {
                    let result = false;
                    if (screen["lockOrientation"])
                        result = screen["lockOrientation"](orientation);
                    else if (screen["webkitLockOrientation"])
                        result = screen["webkitLockOrientation"](orientation);
                    else if (screen["mozLockOrientation"])
                        result = screen["mozLockOrientation"](orientation);
                    else if (screen["msLockOrientation"])
                        result = screen["msLockOrientation"](orientation);
                    if (!result) console.warn("[Construct 3] Failed to lock orientation");
                } catch (err) {
                    console.warn("[Construct 3] Failed to lock orientation: ", err);
                }
        }
        _OnUnlockOrientation() {
            try {
                if (screen["orientation"] && screen["orientation"]["unlock"])
                    screen["orientation"]["unlock"]();
                else if (screen["unlockOrientation"]) screen["unlockOrientation"]();
                else if (screen["webkitUnlockOrientation"])
                    screen["webkitUnlockOrientation"]();
                else if (screen["mozUnlockOrientation"])
                    screen["mozUnlockOrientation"]();
                else if (screen["msUnlockOrientation"]) screen["msUnlockOrientation"]();
            } catch (err) {}
        }
        _OnNavigate(e) {
            const type = e["type"];
            if (type === "back")
                if (navigator["app"] && navigator["app"]["backHistory"])
                    navigator["app"]["backHistory"]();
                else window.back();
            else if (type === "forward") window.forward();
            else if (type === "home") window.home();
            else if (type === "reload") location.reload();
            else if (type === "url") {
                const url = e["url"];
                const target = e["target"];
                const exportType = e["exportType"];
                if (exportType === "windows-uwp" && typeof Windows !== "undefined")
                    Windows["System"]["Launcher"]["launchUriAsync"](
                        new Windows["Foundation"]["Uri"](url)
                    );
                else if (self["cordova"] && self["cordova"]["InAppBrowser"])
                    self["cordova"]["InAppBrowser"]["open"](url, "_system");
                else if (exportType === "preview" || exportType === "windows-webview2")
                    window.open(url, "_blank");
                else if (!this._isScirraArcade)
                    if (target === 2) window.top.location = url;
                    else if (target === 1) window.parent.location = url;
                    else window.location = url;
            } else if (type === "new-window") {
                const url = e["url"];
                const tag = e["tag"];
                const exportType = e["exportType"];
                if (exportType === "windows-uwp" && typeof Windows !== "undefined")
                    Windows["System"]["Launcher"]["launchUriAsync"](
                        new Windows["Foundation"]["Uri"](url)
                    );
                else if (self["cordova"] && self["cordova"]["InAppBrowser"])
                    self["cordova"]["InAppBrowser"]["open"](url, "_system");
                else window.open(url, tag);
            }
        }
        _OnRequestFullscreen(e) {
            const opts = { navigationUI: "auto" };
            const navUI = e["navUI"];
            if (navUI === 1) opts["navigationUI"] = "hide";
            else if (navUI === 2) opts["navigationUI"] = "show";
            const elem = document.documentElement;
            if (elem["requestFullscreen"]) elem["requestFullscreen"](opts);
            else if (elem["mozRequestFullScreen"]) elem["mozRequestFullScreen"](opts);
            else if (elem["msRequestFullscreen"]) elem["msRequestFullscreen"](opts);
            else if (elem["webkitRequestFullScreen"])
                if (typeof Element["ALLOW_KEYBOARD_INPUT"] !== "undefined")
                    elem["webkitRequestFullScreen"](Element["ALLOW_KEYBOARD_INPUT"]);
                else elem["webkitRequestFullScreen"]();
        }
        _OnExitFullscreen() {
            if (document["exitFullscreen"]) document["exitFullscreen"]();
            else if (document["mozCancelFullScreen"])
                document["mozCancelFullScreen"]();
            else if (document["msExitFullscreen"]) document["msExitFullscreen"]();
            else if (document["webkitCancelFullScreen"])
                document["webkitCancelFullScreen"]();
        }
        _OnSetHash(e) {
            location.hash = e["hash"];
        }
        _OnHashChange() {
            this.PostToRuntime("hashchange", { location: location.toString() });
        }
    };
    self.RuntimeInterface.AddDOMHandlerClass(HANDLER_CLASS);
}
("use strict");
{
    const toRemove = [];
    const TWO_PI = Math.PI * 2;
    function clampAngle(a) {
        a %= TWO_PI;
        if (a < 0) a += TWO_PI;
        return a;
    }
    function clamp(x, a, b) {
        if (x < a) return a;
        else if (x > b) return b;
        else return x;
    }
    function lerp(a, b, x) {
        return a + x * (b - a);
    }
    function unlerp(a, b, x) {
        if (a === b) return 0;
        return (x - a) / (b - a);
    }
    function angleDiff(a1, a2) {
        if (a1 === a2) return 0;
        const s1 = Math.sin(a1);
        const c1 = Math.cos(a1);
        const s2 = Math.sin(a2);
        const c2 = Math.cos(a2);
        const n = s1 * s2 + c1 * c2;
        if (n >= 1) return 0;
        if (n <= -1) return Math.PI;
        return Math.acos(n);
    }
    function angleClockwise(a1, a2) {
        const s1 = Math.sin(a1);
        const c1 = Math.cos(a1);
        const s2 = Math.sin(a2);
        const c2 = Math.cos(a2);
        return c1 * s2 - s1 * c2 <= 0;
    }
    function angleLerp(a, b, x) {
        const diff = angleDiff(a, b);
        if (angleClockwise(b, a)) return clampAngle(a + diff * x);
        else return clampAngle(a - diff * x);
    }
    class C3NetValue {
        constructor(index, interp, precision, tag, userData, clientValueTag) {
            this._index = index;
            this._interp = interp;
            this._precision = precision;
            this._tag = tag;
            this._userData = userData;
            this._clientValueTag = clientValueTag;
        }
        GetRuntimeData() {
            return {
                tag: this._tag,
                interp: this._interp,
                userData: this._userData,
                cvt: this._clientValueTag,
            };
        }
        GetIndex() {
            return this._index;
        }
        GetInterp() {
            return this._interp;
        }
        GetPrecision() {
            return this._precision;
        }
        GetTag() {
            return this._tag;
        }
        HasUserData() {
            return typeof this._userData !== "undefined";
        }
        GetUserData() {
            return this._userData;
        }
        GetClientValueTag() {
            return this._clientValueTag;
        }
        Clamp(x) {
            switch (this._precision) {
                case 0:
                    return x;
                case 1:
                    return Math.fround(x);
                case 2:
                    if (this._interp === 2) {
                        x = clampAngle(x);
                        x /= Math.PI;
                        x -= 1;
                        x *= 32767;
                    }
                    return clamp(x | 0, -32768, 32767);
                case 3:
                    if (this._interp === 2) {
                        x = clampAngle(x);
                        x /= TWO_PI;
                        x *= 255;
                    }
                    return clamp(x | 0, 0, 255);
                default:
                    return x;
            }
        }
        Write(dv, ptr, x) {
            switch (this._precision) {
                case 0:
                    dv.setFloat64(ptr, x);
                    ptr += 8;
                    break;
                case 1:
                    dv.setFloat32(ptr, x);
                    ptr += 4;
                    break;
                case 2:
                    dv.setInt16(ptr, x);
                    ptr += 2;
                    break;
                case 3:
                    dv.setUint8(ptr, x);
                    ptr += 1;
                    break;
                default:
                    dv.setFloat32(ptr, x);
                    ptr += 4;
                    break;
            }
            return ptr;
        }
        MaybeUnpack(x) {
            if (this._interp !== 2) return x;
            if (this._precision === 2) {
                x /= 32767;
                x += 1;
                x *= Math.PI;
                return x;
            } else if (this._precision === 3) {
                x /= 255;
                x *= TWO_PI;
                return x;
            } else return x;
        }
        static InterpNetValue(interp, fromVal, toVal, x, extrapolating) {
            switch (interp) {
                case 0:
                    return extrapolating ? toVal : fromVal;
                case 1:
                    return lerp(fromVal, toVal, x);
                case 2:
                    return angleLerp(fromVal, toVal, x);
                default:
                    return extrapolating ? toVal : fromVal;
            }
        }
    }
    class C3NetUpdate {
        constructor(timestamp, data) {
            this.timestamp = timestamp;
            this.data = data;
        }
    }
    class C3NetInstance {
        constructor(ro, id, nid) {
            this._ro = ro;
            this._domHandler = ro.GetDOMHandler();
            this._id = id;
            this._nid = nid;
            this._data = [];
            this._data.length = this._ro.GetNetValues().length;
            this._lastChanged = 0;
            this._lastTransmitted = 0;
            this._transmitMe = false;
            this._isAlive = false;
            this._updates = [];
            this._priorUpdate2 = null;
            this._priorUpdate = null;
            this._nextUpdate = null;
        }
        GetRuntimeData() {
            const interpValues = [];
            for (let i = 0, len = this._ro.GetNetValues().length; i < len; ++i)
                interpValues.push(this.GetInterp(this._ro.GetSimTime(), i));
            const ret = {
                id: this._id,
                nid: this._nid,
                isTimedOut: this.IsTimedOut(),
                interpValues: interpValues,
                latestUpdate: null,
            };
            const latestUpdate = this.GetLatestUpdate();
            if (latestUpdate)
                ret["latestUpdate"] = {
                    timestamp: latestUpdate.timestamp,
                    data: latestUpdate.data,
                };
            return ret;
        }
        GetId() {
            return this._id;
        }
        GetNid() {
            return this._nid;
        }
        SetAlive(a) {
            this._isAlive = !!a;
        }
        IsAlive() {
            return this._isAlive;
        }
        ShouldTransmit() {
            return this._transmitMe;
        }
        UpdateData(data, nowTime) {
            const valuesData = data["netValues"];
            const netValues = this._ro.GetNetValues();
            const valueCount = netValues.length;
            this._transmitMe = false;
            for (let i = 0; i < valueCount; ++i) {
                const nv = netValues[i];
                const value = nv.Clamp(valuesData[i]);
                if (this._data[i] !== value) {
                    this._data[i] = value;
                    this._lastChanged = nowTime;
                    this._ro.SetLastChanged(nowTime);
                }
            }
            const timeSinceChanged = nowTime - this._lastChanged;
            const timeSinceTransmit = nowTime - this._lastTransmitted;
            const bandwidth = this._ro.GetBandwidth();
            if (timeSinceChanged < 100 && bandwidth === 0) this._transmitMe = true;
            else if (timeSinceChanged < 1e3 && bandwidth <= 1)
                this._transmitMe = timeSinceTransmit >= 95;
            else this._transmitMe = timeSinceTransmit >= 495;
            if (this._transmitMe) this._ro.IncNumberToTransmit();
        }
        WriteData(dv, ptr, nowTime) {
            const netValues = this._ro.GetNetValues();
            this._lastTransmitted = nowTime;
            dv.setUint16(ptr, this._nid);
            ptr += 2;
            for (let i = 0, len = this._data.length; i < len; ++i)
                ptr = netValues[i].Write(dv, ptr, this._data[i]);
            return ptr;
        }
        AddUpdate(timestamp, data) {
            for (let i = 0, len = this._updates.length; i < len; ++i) {
                const u = this._updates[i];
                if (u.timestamp === timestamp) return;
                if (u.timestamp > timestamp) {
                    this._updates.splice(i, 0, new C3NetUpdate(timestamp, data));
                    return;
                }
            }
            this._updates.push(new C3NetUpdate(timestamp, data));
        }
        IsTimedOut() {
            if (this._updates.length === 0) return false;
            return (
                this._updates[this._updates.length - 1].timestamp <
                this._ro.GetSimTime() - 3e3
            );
        }
        Tick() {
            while (
                this._updates.length > 2 &&
                this._updates[0] !== this._priorUpdate2 &&
                this._updates[0] !== this._priorUpdate &&
                this._updates[0] !== this._nextUpdate
                )
                this._updates.shift();
            const simTime = this._ro.GetSimTime();
            if (
                this._nextUpdate &&
                this._nextUpdate.timestamp > simTime &&
                this._priorUpdate &&
                this._priorUpdate.timestamp < simTime
            )
                return;
            this._nextUpdate = null;
            for (let i = 0, len = this._updates.length; i < len; ++i) {
                const u = this._updates[i];
                if (u.timestamp <= simTime) {
                    if (!this._priorUpdate || u.timestamp > this._priorUpdate.timestamp) {
                        this._priorUpdate2 = this._priorUpdate;
                        this._priorUpdate = u;
                    }
                } else {
                    this._nextUpdate = u;
                    break;
                }
            }
        }
        GetLatestUpdate() {
            if (this._updates.length === 0) return null;
            return this._updates[this._updates.length - 1];
        }
        GetInterp(simTime, valueIndex, noExtrapolate) {
            if (!this._nextUpdate && !this._priorUpdate) return 0;
            if (this._nextUpdate && !this._priorUpdate)
                return this._nextUpdate.data[valueIndex];
            const netValues = this._ro.GetNetValues();
            let fromTime, fromVal, toTime, toVal, x;
            if (!this._nextUpdate && this._priorUpdate)
                if (this._priorUpdate2 && !noExtrapolate) {
                    fromTime = this._priorUpdate2.timestamp;
                    fromVal = this._priorUpdate2.data[valueIndex];
                    toTime = this._priorUpdate.timestamp;
                    toVal = this._priorUpdate.data[valueIndex];
                    let aheadTime = simTime;
                    if (
                        aheadTime >
                        this._priorUpdate.timestamp + this._ro.GetExtrapolateLimit()
                    )
                        aheadTime =
                            this._priorUpdate.timestamp + this._ro.GetExtrapolateLimit();
                    x = unlerp(fromTime, toTime, aheadTime);
                    return C3NetValue.InterpNetValue(
                        netValues[valueIndex].GetInterp(),
                        fromVal,
                        toVal,
                        x,
                        true
                    );
                } else return this._priorUpdate.data[valueIndex];
            fromTime = this._priorUpdate.timestamp;
            fromVal = this._priorUpdate.data[valueIndex];
            toTime = this._nextUpdate.timestamp;
            toVal = this._nextUpdate.data[valueIndex];
            x = unlerp(fromTime, toTime, simTime);
            return C3NetValue.InterpNetValue(
                netValues[valueIndex].GetInterp(),
                fromVal,
                toVal,
                x,
                false
            );
        }
    }
    class C3RegisteredObject {
        constructor(domHandler, roId, sid, bandwidth) {
            this._domHandler = domHandler;
            this._roId = roId;
            this._sid = sid;
            this._nid = this._domHandler.GetNextObjectNid();
            this._bandwidth = bandwidth;
            this._userData = {};
            this._instanceByteSize = 0;
            this._extrapolateLimit = 250;
            switch (this._bandwidth) {
                case 1:
                    this._extrapolateLimit = 500;
                    break;
                case 2:
                    this._extrapolateLimit = 2500;
                    break;
            }
            this._netValues = [];
            this._netInstances = [];
            this._idToNetInst = new Map();
            this._usedNids = new Set();
            this._nextNid = 0;
            this._lastChanged = 0;
            this._lastTransmitted = 0;
            this._numberToTransmit = 0;
            this._hasOverriddenNids = false;
            this._deadNids = [];
            this._overrideNids = new Map();
            this._nidToNetInst = new Map();
            this._simTime = 0;
            this._domHandler.AddRegisteredObject(this);
        }
        GetDOMHandler() {
            return this._domHandler;
        }
        GetNetValues() {
            return this._netValues;
        }
        GetRoId() {
            return this._roId;
        }
        _SetNid(nid) {
            this._nid = nid;
        }
        GetNid() {
            return this._nid;
        }
        SetLastChanged(lastChanged) {
            this._lastChanged = lastChanged;
        }
        GetBandwidth() {
            return this._bandwidth;
        }
        IncNumberToTransmit() {
            this._numberToTransmit++;
        }
        GetNumberToTransmit() {
            return this._numberToTransmit;
        }
        GetSimTime() {
            return this._simTime;
        }
        _SetHasOverriddenNids(o) {
            this._hasOverriddenNids = !!o;
        }
        HasOverriddenNids() {
            return this._hasOverriddenNids;
        }
        GetExtrapolateLimit() {
            return this._extrapolateLimit;
        }
        GetSid() {
            return this._sid;
        }
        GetDeadNids() {
            return this._deadNids;
        }
        AddValue(interp, precision, tag, userData, clientValueTag) {
            const nv = new C3NetValue(
                this._netValues.length,
                interp,
                precision,
                tag,
                userData,
                clientValueTag
            );
            switch (precision) {
                case 0:
                    this._instanceByteSize += 8;
                    break;
                case 1:
                    this._instanceByteSize += 4;
                    break;
                case 2:
                    this._instanceByteSize += 2;
                    break;
                case 3:
                    this._instanceByteSize += 1;
                    break;
            }
            this._netValues.push(nv);
        }
        AddUpdate(timestamp, instNid, arr) {
            const inst = this.GetNetInstForNid(instNid);
            inst.AddUpdate(timestamp, arr);
        }
        Tick() {
            this._simTime = this._domHandler.GetSimulationTime();
            for (const netInst of this._netInstances) netInst.Tick();
        }
        GetCount() {
            return this._netInstances.length;
        }
        GetNetInstAt(index) {
            index = Math.floor(index);
            if (index < 0 || index >= this._netInstances.length) return null;
            return this._netInstances[index];
        }
        GetNetInstByNid(nid) {
            for (const netInst of this._netInstances)
                if (netInst.GetNid() === nid) return netInst;
            return null;
        }
        GetNetValuesJson() {
            const ret = [];
            for (const v of this._netValues) {
                const o = {
                    tag: v.GetTag(),
                    precision: v.GetPrecision(),
                    interp: v.GetInterp(),
                    clientvaluetag: v.GetClientValueTag(),
                };
                if (v.HasUserData()) o["userdata"] = v.GetUserData();
                ret.push(o);
            }
            return ret;
        }
        SetNetValuesFrom(nvs) {
            this._netValues.length = 0;
            this._instanceByteSize = 0;
            for (const v of nvs)
                this.AddValue(
                    v["interp"],
                    v["precision"],
                    v["tag"],
                    v["userdata"],
                    v["clientvaluetag"]
                );
        }
        GetNetInstForNid(nid) {
            let ret = this._nidToNetInst.get(nid);
            if (ret) return ret;
            ret = new C3NetInstance(this, -1, nid);
            this._nidToNetInst.set(nid, ret);
            this._netInstances.push(ret);
            return ret;
        }
        GetNetInstForId(id) {
            let ret = this._idToNetInst.get(id);
            if (ret) return ret;
            ret = new C3NetInstance(this, id, this.AllocateInstanceNid());
            this._idToNetInst.set(id, ret);
            this._netInstances.push(ret);
            return ret;
        }
        AllocateInstanceNid() {
            do {
                this._nextNid++;
                if (this._nextNid > 65535) this._nextNid = 0;
            } while (this._usedNids.has(this._nextNid));
            const nid = this._nextNid;
            this._usedNids.add(nid);
            return nid;
        }
        RemoveNetInstance(netInst) {
            const id = netInst.GetId();
            const nid = netInst.GetNid();
            if (this._domHandler.IsHost() && !this._hasOverriddenNids)
                this._deadNids.push(nid);
            this._idToNetInst.delete(id);
            this._nidToNetInst.delete(nid);
            this._usedNids.delete(nid);
            const i = this._netInstances.indexOf(netInst);
            if (i > -1) this._netInstances.splice(i, 1);
        }
        ClearAllNetInstances() {
            this._deadNids.length = 0;
            this._idToNetInst.clear();
            this._nidToNetInst.clear();
            this._usedNids.clear();
            this._netInstances.length = 0;
        }
        UpdateData(instInfo, nowTime) {
            this._numberToTransmit = 0;
            for (const netInst of this._netInstances) netInst.SetAlive(false);
            for (let i = 0, len = instInfo.length; i < len; ++i) {
                const d = instInfo[i];
                const id = d["uid"];
                const netInst = this.GetNetInstForId(id);
                netInst.SetAlive(true);
                netInst.UpdateData(d, nowTime);
            }
            for (const netInst of this._netInstances)
                if (!netInst.IsAlive()) toRemove.push(netInst);
            for (const netInst of toRemove) this.RemoveNetInstance(netInst);
            toRemove.length = 0;
        }
        WriteData(dv, ptr, nowTime) {
            dv.setUint16(ptr, this._nid);
            ptr += 2;
            let flags = 0;
            if (this._hasOverriddenNids) flags = 1;
            dv.setUint8(ptr, flags);
            ptr += 1;
            dv.setUint16(ptr, this._numberToTransmit);
            ptr += 2;
            dv.setUint16(ptr, this._instanceByteSize);
            ptr += 2;
            for (const netInst of this._netInstances)
                if (netInst.ShouldTransmit()) ptr = netInst.WriteData(dv, ptr, nowTime);
            return ptr;
        }
        OverrideNid(id, nid) {
            if (this._idToNetInst.has(id)) {
                console.warn(
                    "OverrideNid passed id " +
                    id +
                    " which is already in use and cannot be overridden"
                );
                return;
            }
            if (this._usedNids.has(nid)) {
                console.warn(
                    "OverrideNid passed nid " +
                    nid +
                    " which is already in use and cannot be overridden"
                );
                return;
            }
            const ret = new C3NetInstance(this, id, nid);
            this._idToNetInst.set(id, ret);
            this._usedNids.add(nid);
            this._netInstances.push(ret);
            this._hasOverriddenNids = true;
            return ret;
        }
        RemoveObjectId(id) {
            const netInst = this._idToNetInst.get(id);
            if (netInst) this.RemoveNetInstance(netInst);
        }
        RemoveObjectNid(nid) {
            const netInst = this._nidToNetInst.get(nid);
            if (netInst) this.RemoveNetInstance(netInst);
        }
        GetRuntimeData() {
            return {
                hasOverriddenNids: this.HasOverriddenNids(),
                netValues: this._netValues.map((nv) => nv.GetRuntimeData()),
                netInstances: this._netInstances.map((ni) => ni.GetRuntimeData()),
            };
        }
        GetRuntimeInfoRequest() {
            return {
                roId: this._roId,
                sid: this._sid,
                netValues: this._netValues.map((nv) => nv.GetRuntimeData()),
            };
        }
    }
    self.C3NetValue = C3NetValue;
    self.C3NetUpdate = C3NetUpdate;
    self.C3RegisteredObject = C3RegisteredObject;
}
("use strict");
{
    const C3NetUpdate = self.C3NetUpdate;
    const C3NetValue = self.C3NetValue;
    const RTCPeerConnection =
        window["RTCPeerConnection"] ||
        window["webkitRTCPeerConnection"] ||
        window["mozRTCPeerConnection"] ||
        window["msRTCPeerConnection"];
    const MAGIC_NUMBER = 1664249200;
    function CloseIgnoreException(o) {
        if (!o) return;
        try {
            o.close();
        } catch (e) {}
    }
    const tempArray = [];
    function unlerp(a, b, x) {
        if (a === b) return 0;
        return (x - a) / (b - a);
    }
    class C3Peer {
        constructor(domHandler, id, alias) {
            this._domHandler = domHandler;
            this._id = id;
            this._nid = 0;
            this._alias = alias;
            this._pc = null;
            this._dco = null;
            this._isOOpen = false;
            this._dcr = null;
            this._isROpen = false;
            this._dcu = null;
            this._isUOpen = false;
            this._firedOpen = false;
            this._firedClose = false;
            this._wasRemoved = false;
            this._hasConfirmed = false;
            this._lastHeardFrom = 0;
            this._connectTime = 0;
            this._errorCount = 0;
            this._localClientState = [];
            this._lastStateChange = 0;
            this._lastStateTransmit = 0;
            this._clientStateUpdates = [];
            this._priorUpdate2 = null;
            this._priorUpdate = null;
            this._nextUpdate = null;
            this._lastPingSent = 0;
            this._awaitingPong = false;
            this._lastSentPingId = 1;
            this._lastPingTimes = [];
            this._latency = 0;
            this._pdv = 0;
            this._domHandler._AddPeer(this);
        }
        GetId() {
            return this._id;
        }
        GetNid() {
            return this._nid;
        }
        _SetNid(nid) {
            this._nid = nid;
        }
        GetAlias() {
            return this._alias;
        }
        IsHost() {
            return this === this._domHandler.GetHostPeer();
        }
        IsSelf() {
            return this === this._domHandler.GetSelfPeer();
        }
        GetLocalClientState() {
            return this._localClientState;
        }
        _SetLastStateChange(t) {
            this._lastStateChange = t;
        }
        GetLastStateChange() {
            return this._lastStateChange;
        }
        _SetLastStateTransmit(t) {
            this._lastStateTransmit = t;
        }
        GetLastStateTransmit() {
            return this._lastStateTransmit;
        }
        GetLatency() {
            return this._latency;
        }
        GetPdv() {
            return this._pdv;
        }
        _AttachDataChannelHandlers(dc, type) {
            dc.binaryType = "arraybuffer";
            dc.onopen = () => {
                if (type === "o") this._isOOpen = true;
                else if (type === "r") this._isROpen = true;
                else if (type === "u") this._isUOpen = true;
                this._MaybeFireOpen();
            };
            dc.onmessage = (m) => {
                this._OnMessage(type, m);
            };
            dc.onerror = (err) => {
                console.error(
                    "Peer '" + this._id + "' datachannel '" + type + "' error: ",
                    err
                );
                this._domHandler._OnPeerError(this, err);
                if (this._domHandler.IsHost() && !this.IsHost())
                    this.Remove("network error");
            };
            dc.onclose = () => {
                this.Remove("disconnect");
            };
        }
        Connect() {
            if (this.IsSelf()) return;
            const isHost = this._domHandler.IsHost();
            this._isOOpen = false;
            this._isROpen = false;
            this._isUOpen = false;
            this._firedOpen = false;
            this._firedClose = false;
            this._connectTime = performance.now();
            this._pc = new RTCPeerConnection({
                iceServers: this._domHandler.GetICEServerList(),
            });
            this._pc.onicecandidate = (e) => {
                if (e.candidate)
                    this._domHandler.SignallingSend({
                        message: "icecandidate",
                        toclientid: this._id,
                        icecandidate: e.candidate,
                    });
            };
            this._pc.onsignalingstatechange = () => {
                if (!this._pc) return;
                if (this._pc.signalingState === "closed") this.Remove("disconnect");
            };
            this._pc.oniceconnectionstatechange = () => {
                if (!this._pc) return;
                if (
                    this._pc.iceConnectionState === "failed" ||
                    this._pc.iceConnectionState === "closed"
                )
                    this.Remove("disconnect");
            };
            this._pc["onconnectionstatechange"] = () => {
                if (!this._pc) return;
                const connectionState = this._pc["connectionState"];
                if (connectionState === "failed" || connectionState === "closed")
                    this.Remove("disconnect");
            };
            const dc_protocol = `c2mp_${this._domHandler.GetCurrentGame()}_${this._domHandler.GetCurrentGameInstance()}_${this._domHandler.GetCurrentRoom()}`;
            if (isHost) {
                this._nid = this._domHandler.AllocatePeerNid();
                this._dco = this._pc.createDataChannel("o", {
                    ordered: true,
                    protocol: dc_protocol,
                });
                this._AttachDataChannelHandlers(this._dco, "o");
                this._dcr = this._pc.createDataChannel("r", {
                    ordered: false,
                    protocol: dc_protocol,
                });
                this._AttachDataChannelHandlers(this._dcr, "r");
                this._dcu = this._pc.createDataChannel("u", {
                    ordered: false,
                    maxRetransmits: 0,
                    protocol: dc_protocol,
                });
                this._AttachDataChannelHandlers(this._dcu, "u");
                this._pc
                    .createOffer()
                    .then((offer) => {
                        this._pc.setLocalDescription(offer);
                        this._domHandler.SignallingSend({
                            message: "offer",
                            toclientid: this._id,
                            offer: offer,
                        });
                    })
                    .catch((err) => {
                        console.error(
                            "Host error creating offer for peer '" + this._id + "': ",
                            err
                        );
                        this._domHandler._OnPeerError(
                            this,
                            "could not create offer for peer"
                        );
                    });
            } else
                this._pc.ondatachannel = (e) => {
                    if (e.channel.protocol !== dc_protocol) {
                        console.error(
                            "Unexpected datachannel protocol '" +
                            e.channel.protocol +
                            "', should be '" +
                            dc_protocol +
                            "'"
                        );
                        this._domHandler._OnPeerError(
                            this,
                            "unexpected datachannel protocol '" +
                            e.channel.protocol +
                            "', should be '" +
                            dc_protocol +
                            "'"
                        );
                        return;
                    }
                    const label = e.channel.label;
                    if (label === "o") this._dco = e.channel;
                    else if (label === "r") this._dcr = e.channel;
                    else if (label === "u") this._dcu = e.channel;
                    else {
                        console.error("Unknown datachannel label: " + e.channel.label);
                        this._domHandler._OnPeerError(
                            this,
                            "unknown datachannel label '" + e.channel.label + "'"
                        );
                    }
                    this._AttachDataChannelHandlers(e.channel, label);
                };
        }
        async _AddICECandidate(iceCandidate) {
            if (!this._pc) return;
            try {
                await this._pc.addIceCandidate(iceCandidate);
            } catch (err) {
                console.warn("[Multiplayer] Error adding ICE candidate: ", err);
            }
        }
        HasPeerConnection() {
            return !!this._pc;
        }
        GetPeerConnection() {
            return this._pc;
        }
        _MaybeFireOpen() {
            if (this._firedOpen) return;
            if (this._isROpen && this._isUOpen && this._isOOpen) {
                this._OnOpen();
                this._firedOpen = true;
                this._firedClose = false;
            }
        }
        _OnOpen() {
            this._lastHeardFrom = performance.now();
            if (this._domHandler.IsHost()) {
                this._domHandler.HostBroadcast(
                    "o",
                    JSON.stringify({ c: "j", i: this._id, n: this._nid, a: this._alias }),
                    this
                );
                this.Send(
                    "o",
                    JSON.stringify({
                        c: "hi",
                        hn: this._domHandler.GetHostPeer().GetNid(),
                        n: this._nid,
                        d: this._domHandler.GetClientDelay(),
                        u: this._domHandler.GetPeerUpdateRateSec(),
                        objs: this._domHandler.GetRegisteredObjectsMap(),
                        cvs: this._domHandler.GetClientValuesJson(),
                    })
                );
                for (const p of this._domHandler.peers()) {
                    if (p.IsHost() || p === this || !p.IsOpen()) continue;
                    this.Send(
                        "o",
                        JSON.stringify({
                            c: "j",
                            i: p.GetId(),
                            n: p.GetNid(),
                            a: p.GetAlias(),
                        })
                    );
                }
            } else {
                this._hasConfirmed = true;
                if (this.IsHost()) this.SendPing(performance.now(), true);
            }
            this._domHandler._OnPeerOpen(this);
        }
        _MaybeFireClose(reason) {
            if (this._firedClose || !this._firedOpen) return;
            this._OnClose(reason);
            this._firedClose = true;
            this._firedOpen = false;
        }
        _OnClose(reason) {
            if (this._domHandler.IsHost() && !this.IsSelf())
                this._domHandler.HostBroadcast(
                    "o",
                    JSON.stringify({ c: "l", i: this._id, a: this._alias, r: reason }),
                    this
                );
            if (!this.IsSelf()) this._domHandler._OnPeerClose(this, reason);
        }
        IsOpen() {
            return this._firedOpen && !this._firedClose;
        }
        Send(type, m) {
            this._domHandler.StatIncOutboundCount();
            let messageSize = 0;
            if (m.length) messageSize = m.length;
            else if (m.byteLength) messageSize = m.byteLength;
            this._domHandler.StatAddOutboundBandwidthCount(messageSize);
            const simulatedPacketLoss = this._domHandler.GetSimulatedPacketLoss();
            const simulatedLatency = this._domHandler.GetSimulatedLatency();
            const simulatedPdv = this._domHandler.GetSimulatedPdv();
            if (simulatedPacketLoss > 0 && type === "u")
                if (Math.random() < simulatedPacketLoss) return;
            if (simulatedLatency === 0 && simulatedPdv === 0) this._DoSend(type, m);
            else {
                let multiplier = 1;
                if (type !== "u" && Math.random() < simulatedPacketLoss) multiplier = 3;
                setTimeout(
                    () => this._DoSend(type, m),
                    simulatedLatency * multiplier +
                    Math.random() * simulatedPdv * multiplier
                );
            }
        }
        _DoSend(type, m) {
            try {
                if (type === "o") {
                    if (this._isOOpen && this._dco) this._dco.send(m);
                } else if (type === "r") {
                    if (this._isROpen && this._dcr) this._dcr.send(m);
                } else if (type === "u")
                    if (this._isUOpen && this._dcu) this._dcu.send(m);
            } catch (err) {
                if (this._wasRemoved) return;
                if (this._domHandler.IsHost())
                    if (type === "o" || type === "r") {
                        if (typeof m === "string") {
                            console.error(
                                "Error sending " +
                                m.length +
                                "-char string on '" +
                                type +
                                "' to '" +
                                this._alias +
                                "', host kicking: ",
                                err
                            );
                            console.log(
                                "String that failed to send from previous error was: " + m
                            );
                        } else
                            console.error(
                                "Error sending " +
                                (m.length || m.byteLength) +
                                "-byte binary on '" +
                                type +
                                "' to '" +
                                this._alias +
                                "', host kicking: ",
                                err
                            );
                        this.Remove("network error");
                    } else {
                        this._errorCount++;
                        if (this._errorCount >= 10) {
                            if (typeof m === "string") {
                                console.error(
                                    "Too many errors (" +
                                    this._errorCount +
                                    ") sending data on '" +
                                    type +
                                    "' to '" +
                                    this._alias +
                                    "', kicking; last error was for sending " +
                                    m.length +
                                    "-char string: ",
                                    err
                                );
                                console.log(
                                    "String that failed to send from previous error was: " + m
                                );
                            } else
                                console.error(
                                    "Too many errors (" +
                                    this._errorCount +
                                    ") sending data on '" +
                                    type +
                                    "' to '" +
                                    this._alias +
                                    "', kicking; last error was for sending " +
                                    (m.length || m.byteLength) +
                                    "-byte binary: ",
                                    err
                                );
                            this.Remove("network error");
                        }
                    }
                else console.error("Error sending data on '" + type + "': ", err);
            }
        }
        SendPing(nowTime, force) {
            if (this._wasRemoved) return;
            if (
                !force &&
                !this.IsOpen() &&
                this._pc &&
                nowTime - this._connectTime > 25e3
            ) {
                console.warn(
                    "Timed out '" +
                    this._alias +
                    "', could not establish connection after 25sec"
                );
                this.Remove("timeout");
                return;
            }
            if (!force && this.IsOpen() && nowTime - this._lastHeardFrom > 2e4) {
                console.warn(
                    "Timed out '" + this._alias + "', not heard from for 20sec"
                );
                this.Remove("timeout");
                return;
            }
            this._lastPingSent = nowTime;
            this._awaitingPong = true;
            this._lastSentPingId++;
            this.Send("u", "ping:" + this._lastSentPingId);
        }
        SendPong(pingStr) {
            let response = "pong:" + pingStr.substr(5);
            if (this._domHandler.IsHost()) {
                response += "/";
                response += Math.round(performance.now()).toString();
            }
            this.Send("u", response);
        }
        _OnPong(str) {
            if (!this._awaitingPong) return;
            const colon = str.indexOf(":");
            if (colon > -1) {
                const pongId = parseFloat(str.substr(colon + 1));
                if (pongId !== this._lastSentPingId) return;
            } else {
                console.warn("Cannot parse off ping ID from pong");
                return;
            }
            const nowTime = performance.now();
            this._awaitingPong = false;
            const lastLatency = (nowTime - this._lastPingSent) / 2;
            this._lastPingTimes.push(lastLatency);
            if (this._lastPingTimes.length > 10) this._lastPingTimes.shift();
            tempArray.push(...this._lastPingTimes);
            tempArray.sort((a, b) => a - b);
            this._pdv = tempArray[tempArray.length - 1] - tempArray[0];
            let start = 0;
            let end = tempArray.length;
            if (tempArray.length >= 4 && tempArray.length <= 6) {
                ++start;
                --end;
            } else if (tempArray.length > 6) {
                start += 2;
                end -= 2;
            }
            let sum = 0;
            for (let i = start; i < end; ++i) sum += tempArray[i];
            this._latency = sum / (end - start);
            tempArray.length = 0;
            if (!this._domHandler.IsHost()) {
                const slash = str.indexOf("/");
                if (slash > -1) {
                    const hostTime = parseFloat(str.substr(slash + 1));
                    if (isFinite(hostTime))
                        this._domHandler.AddHostTime(
                            hostTime,
                            nowTime,
                            lastLatency,
                            this._latency
                        );
                    else console.warn("Invalid host time from pong response");
                } else console.warn("Cannot parse off host time from pong response");
            }
        }
        _OnMessage(type, m) {
            const simulatedPacketLoss = this._domHandler.GetSimulatedPacketLoss();
            const simulatedLatency = this._domHandler.GetSimulatedLatency();
            const simulatedPdv = this._domHandler.GetSimulatedPdv();
            if (simulatedPacketLoss > 0 && type === "u")
                if (Math.random() < simulatedPacketLoss) return;
            if (simulatedLatency === 0 && simulatedPdv === 0)
                this._DoOnMessage(type, m);
            else {
                let multiplier = 1;
                if (type !== "u" && Math.random() < simulatedPacketLoss) multiplier = 3;
                setTimeout(
                    () => this._DoOnMessage(type, m),
                    simulatedLatency * multiplier +
                    Math.random() * simulatedPdv * multiplier
                );
            }
        }
        _DoOnMessage(type, m) {
            if (this._wasRemoved) return;
            this._lastHeardFrom = performance.now();
            this._domHandler.StatIncInboundCount();
            let messageSize = 0;
            if (m.data.length) messageSize = m.data.length;
            else if (m.data.byteLength) messageSize = m.data.byteLength;
            this._domHandler.StatAddInboundBandwidthCount(messageSize);
            if (typeof m.data === "string") {
                if (m.data.trim() === "" || m.data.length < 4) return;
                const first4 = m.data.substr(0, 4);
                if (first4 === "ping") {
                    this.SendPong(m.data);
                    return;
                }
                if (first4 === "pong") {
                    this._OnPong(m.data);
                    return;
                }
                var o;
                try {
                    o = JSON.parse(m.data);
                } catch (err) {
                    this._domHandler._OnPeerError(this, err);
                    if (this._domHandler.IsHost()) {
                        console.error(
                            "Error parsing message as JSON for peer '" +
                            this._id +
                            "', host kicking: ",
                            err
                        );
                        this.Remove("data error");
                    } else
                        console.error(
                            "Error parsing message as JSON for peer '" + this._id + "': ",
                            err
                        );
                    console.log(
                        "String that failed to parse from previous error: " + m.data
                    );
                    return;
                }
                if (!o) return;
                try {
                    if (o["c"] && o["c"] !== "m") this._OnControlMessage(o);
                    else this._domHandler._OnPeerMessage(this, o);
                } catch (err) {
                    this._domHandler._OnPeerError(this, err);
                    if (this._domHandler.IsHost()) {
                        console.error(
                            "Error handling message for peer '" +
                            this._id +
                            "', host kicking: ",
                            err
                        );
                        this.Remove("data error");
                    } else
                        console.error(
                            "Error handling message for peer '" + this._id + "': ",
                            err
                        );
                }
                return;
            } else {
                if (!this._hasConfirmed && this._domHandler.IsHost() && type === "u") {
                    this._hasConfirmed = true;
                    this._domHandler.SignallingConfirmPeer(this._id);
                }
                try {
                    this._OnBinaryMessage(m.data);
                } catch (err) {
                    this._domHandler._OnPeerError(this, err);
                    if (this._domHandler.IsHost()) {
                        console.error(
                            "Error handling binary update for peer '" +
                            this._id +
                            "', host kicking: ",
                            err
                        );
                        this.Remove("data error");
                    } else
                        console.error(
                            "Error handling binary update for peer '" + this._id + "': ",
                            err
                        );
                    return;
                }
            }
        }
        _OnControlMessage(o) {
            let peer;
            let leaveRoom;
            switch (o["c"]) {
                case "disconnect":
                    if (o["k"]) this._domHandler.PostToRuntime("peer-kicked");
                    leaveRoom = !this._domHandler.IsHost() && !this.IsHost();
                    this.Remove(o["r"]);
                    if (leaveRoom) this._domHandler.SignallingLeaveRoom();
                    break;
                case "hi":
                    if (!this._domHandler.IsHost()) {
                        this._domHandler.GetHostPeer()._SetNid(o["hn"]);
                        this._domHandler.GetSelfPeer()._SetNid(o["n"]);
                        this._domHandler.SetClientDelay(o["d"]);
                        this._domHandler.SetPeerUpdateRateSec(o["u"]);
                        this._domHandler.MapObjectNids(o["objs"]);
                        this._domHandler.MapClientValues(o["cvs"]);
                    }
                    break;
                case "j":
                    if (!this._domHandler.IsHost()) {
                        peer = new C3Peer(this._domHandler, o["i"], o["a"]);
                        peer._SetNid(o["n"]);
                        this._domHandler._OnPeerOpen(peer);
                    }
                    break;
                case "l":
                    if (!this._domHandler.IsHost()) {
                        peer = this._domHandler.GetPeerById(o["i"]);
                        if (peer) {
                            if (!peer.IsSelf()) this._domHandler._OnPeerClose(peer, o["r"]);
                            peer.Remove(o["r"]);
                        }
                    }
                    break;
                default:
                    console.error(
                        "Unknown control message from peer '" + this._id + "': " + o["c"]
                    );
                    this._domHandler._OnPeerError(
                        this,
                        "unknown control message '" + o["c"] + "'"
                    );
                    break;
            }
        }
        _OnBinaryMessage(buffer) {
            if (this._domHandler.IsHost()) this._OnHostUpdate(buffer);
            else this._OnPeerUpdate(buffer);
        }
        _OnHostUpdate(buffer) {
            const view = new DataView(buffer);
            let ptr = 0;
            const magicNumber = view.getUint32(ptr);
            ptr += 4;
            if (magicNumber !== MAGIC_NUMBER) {
                console.warn(
                    "Rejected packet with incorrect magic number (received '" +
                    magicNumber +
                    "', expected '" +
                    MAGIC_NUMBER +
                    "'"
                );
                return;
            }
            let timestamp = view.getFloat64(ptr);
            ptr += 8;
            timestamp += this._latency;
            if (Math.abs(timestamp - performance.now()) >= 3e3) return;
            const flags = view.getUint8(ptr);
            ptr += 1;
            const len = view.getUint8(ptr);
            ptr += 1;
            const arr = [];
            const clientValues = this._domHandler.GetClientValues();
            for (let i = 0; i < len; ++i) {
                if (i >= clientValues.length) {
                    arr.push(0);
                    continue;
                }
                const cv = clientValues[i];
                let value = 0;
                switch (cv.GetPrecision()) {
                    case 0:
                        value = view.getFloat64(ptr);
                        ptr += 8;
                        break;
                    case 1:
                        value = view.getFloat32(ptr);
                        ptr += 4;
                        break;
                    case 2:
                        value = cv.MaybeUnpack(view.getInt16(ptr));
                        ptr += 2;
                        break;
                    case 3:
                        value = cv.MaybeUnpack(view.getUint8(ptr));
                        ptr += 1;
                        break;
                    default:
                        value = view.getFloat32(ptr);
                        ptr += 4;
                        break;
                }
                arr.push(value);
            }
            this._AddClientUpdate(timestamp, arr);
        }
        _AddClientUpdate(timestamp, data) {
            for (let i = 0, len = this._clientStateUpdates.length; i < len; ++i) {
                const u = this._clientStateUpdates[i];
                if (u.timestamp === timestamp) return;
                if (u.timestamp > timestamp) {
                    this._clientStateUpdates.splice(
                        i,
                        0,
                        new C3NetUpdate(timestamp, data)
                    );
                    return;
                }
            }
            this._clientStateUpdates.push(new C3NetUpdate(timestamp, data));
        }
        Tick(simTime) {
            if (this._clientStateUpdates.length === 0) return;
            while (
                this._clientStateUpdates.length > 2 &&
                this._clientStateUpdates[0] !== this._priorUpdate2 &&
                this._clientStateUpdates[0] !== this._priorUpdate &&
                this._clientStateUpdates[0] !== this._nextUpdate
                )
                this._clientStateUpdates.shift();
            if (
                this._nextUpdate &&
                this._nextUpdate.timestamp > simTime &&
                this._priorUpdate &&
                this._priorUpdate.timestamp < simTime
            )
                return;
            this._nextUpdate = null;
            for (let i = 0, len = this._clientStateUpdates.length; i < len; ++i) {
                const u = this._clientStateUpdates[i];
                if (u.timestamp <= simTime) {
                    if (!this._priorUpdate || u.timestamp > this._priorUpdate.timestamp) {
                        this._priorUpdate2 = this._priorUpdate;
                        this._priorUpdate = u;
                    }
                } else {
                    this._nextUpdate = u;
                    break;
                }
            }
        }
        _OnPeerUpdate(buffer) {
            const view = new DataView(buffer);
            let ptr = 0;
            const magicNumber = view.getUint32(ptr);
            ptr += 4;
            if (magicNumber !== MAGIC_NUMBER) {
                console.warn(
                    "Rejected packet with incorrect magic number (received '" +
                    magicNumber +
                    "', expected '" +
                    MAGIC_NUMBER +
                    "'"
                );
                return;
            }
            const flags = view.getUint32(ptr);
            ptr += 4;
            if (flags === 0) this._HandlePeerUpdate(view, ptr);
            else if (flags === 1) this._HandlePeerEvents(view, ptr);
            else
                console.warn(
                    "Ignoring packet with incorrect flags (received " +
                    flags +
                    ", expected 0 or 1"
                );
        }
        _HandlePeerUpdate(view, ptr) {
            const timestamp = view.getFloat64(ptr);
            ptr += 8;
            const robjCount = view.getUint16(ptr);
            ptr += 2;
            for (let i = 0; i < robjCount; ++i) {
                const nid = view.getUint16(ptr);
                ptr += 2;
                const flags = view.getUint8(ptr);
                ptr += 1;
                let netValues = null;
                let valueCount = 0;
                const ro = this._domHandler.GetRegisteredObjectByNid(nid);
                if (ro) {
                    netValues = ro.GetNetValues();
                    valueCount = netValues.length;
                    if (flags === 1) ro._SetHasOverriddenNids(true);
                } else
                    console.warn("Don't know which object corresponds to NID " + nid);
                const count = view.getUint16(ptr);
                ptr += 2;
                const valueSize = view.getUint16(ptr);
                ptr += 2;
                for (let j = 0; j < count; ++j) {
                    const instNid = view.getUint16(ptr);
                    ptr += 2;
                    if (ro) {
                        const arr = [];
                        let vptr = ptr;
                        for (let k = 0; k < valueCount; ++k) {
                            const nv = netValues[k];
                            let value = 0;
                            switch (nv.GetPrecision()) {
                                case 0:
                                    value = view.getFloat64(vptr);
                                    vptr += 8;
                                    break;
                                case 1:
                                    value = view.getFloat32(vptr);
                                    vptr += 4;
                                    break;
                                case 2:
                                    value = nv.MaybeUnpack(view.getInt16(vptr));
                                    vptr += 2;
                                    break;
                                case 3:
                                    value = nv.MaybeUnpack(view.getUint8(vptr));
                                    vptr += 1;
                                    break;
                                default:
                                    value = view.getFloat32(vptr);
                                    vptr += 4;
                                    break;
                            }
                            arr.push(value);
                        }
                        ro.AddUpdate(timestamp, instNid, arr);
                    }
                    ptr += valueSize;
                }
            }
        }
        _HandlePeerEvents(view, ptr) {
            const timestamp = view.getFloat64(ptr);
            ptr += 8;
            const robjCount = view.getUint16(ptr);
            ptr += 2;
            for (let i = 0; i < robjCount; ++i) {
                const roNid = view.getUint16(ptr);
                ptr += 2;
                const ro = this._domHandler.GetRegisteredObjectByNid(roNid);
                if (!ro)
                    console.warn("Don't know which object corresponds to NID " + roNid);
                const lenj = view.getUint16(ptr);
                ptr += 2;
                for (let j = 0; j < lenj; ++j) {
                    const deadNid = view.getUint16(ptr);
                    ptr += 2;
                    if (!ro) continue;
                    if (ro.HasOverriddenNids()) continue;
                    this._domHandler._OnInstanceDestroyed(ro, deadNid, timestamp);
                    ro.RemoveObjectNid(deadNid);
                }
            }
        }
        Remove(reason, isKick) {
            if (this._wasRemoved) return;
            this._wasRemoved = true;
            this._MaybeFireClose(reason);
            this.Send(
                "o",
                JSON.stringify({ c: "disconnect", r: reason, k: !!isKick })
            );
            const dco = this._dco;
            const dcr = this._dcr;
            const dcu = this._dcu;
            const pc = this._pc;
            setTimeout(() => {
                CloseIgnoreException(dco);
                CloseIgnoreException(dcr);
                CloseIgnoreException(dcu);
                CloseIgnoreException(pc);
            }, 0);
            this._dco = null;
            this._dcr = null;
            this._dcu = null;
            this._pc = null;
            this._isOOpen = false;
            this._isROpen = false;
            this._isUOpen = false;
            this._domHandler._RemovePeer(this);
        }
        HasClientState(tag) {
            return this._domHandler.HasClientValueTag(tag);
        }
        GetClientState(tag) {
            const cv = this._domHandler.GetClientValueByTag(tag);
            if (!cv) return 0;
            const i = cv.GetIndex();
            if (this._clientStateUpdates.length === 0) return 0;
            const arr = this._clientStateUpdates[this._clientStateUpdates.length - 1]
                .data;
            if (i < 0 || i >= arr.length) return 0;
            return arr[i];
        }
        GetInterpClientState(cv) {
            const i = cv.GetIndex();
            if (!this._nextUpdate && !this._priorUpdate) return 0;
            if (this._nextUpdate && !this._priorUpdate) {
                const arr = this._nextUpdate.data;
                if (i < 0 || i >= arr.length) return 0;
                else return arr[i];
            }
            const simTime = this._domHandler.GetSimulationTime();
            let fromTime, fromVal, toTime, toVal, x;
            if (!this._nextUpdate && this._priorUpdate)
                if (this._priorUpdate2) {
                    fromTime = this._priorUpdate2.timestamp;
                    fromVal = this._priorUpdate2.data[i];
                    toTime = this._priorUpdate.timestamp;
                    toVal = this._priorUpdate.data[i];
                    let aheadTime = simTime;
                    if (aheadTime > this._priorUpdate.timestamp + 250)
                        aheadTime = this._priorUpdate.timestamp + 250;
                    x = unlerp(fromTime, toTime, aheadTime);
                    return C3NetValue.InterpNetValue(
                        this._domHandler.GetClientValues()[i].GetInterp(),
                        fromVal,
                        toVal,
                        x,
                        true
                    );
                } else {
                    const arr = this._priorUpdate.data;
                    if (i < 0 || i >= arr.length) return 0;
                    else return arr[i];
                }
            fromTime = this._priorUpdate.timestamp;
            fromVal = this._priorUpdate.data[i];
            toTime = this._nextUpdate.timestamp;
            toVal = this._nextUpdate.data[i];
            x = unlerp(fromTime, toTime, simTime);
            return C3NetValue.InterpNetValue(
                this._domHandler.GetClientValues()[i].GetInterp(),
                fromVal,
                toVal,
                x,
                false
            );
        }
    }
    self.C3Peer = C3Peer;
}
("use strict");
{
    const C3NetValue = self.C3NetValue;
    const C3Peer = self.C3Peer;
    const DOM_COMPONENT_ID = "multiplayer";
    const RTCPeerConnection =
        window["RTCPeerConnection"] ||
        window["webkitRTCPeerConnection"] ||
        window["mozRTCPeerConnection"] ||
        window["msRTCPeerConnection"];
    const RTCSessionDescription =
        window["RTCSessionDescription"] ||
        window["webkitRTCSessionDescription"] ||
        window["mozRTCSessionDescription"] ||
        window["msRTCSessionDescription"];
    const RTCIceCandidate =
        window["RTCIceCandidate"] ||
        window["webkitRTCIceCandidate"] ||
        window["mozRTCIceCandidate"] ||
        window["msRTCIceCandidate"];
    const RTCDataChannel =
        window["RTCDataChannel"] ||
        window["webkitRTCDataChannel"] ||
        window["mozRTCDataChannel"] ||
        window["msRTCDataChannel"];
    const SIGNALLING_WEBSOCKET_PROTOCOL = "c2multiplayer";
    const SIGNALLING_PROTOCOL_REVISION = 1;
    const MAGIC_NUMBER = 1664249200;
    const DEFAULT_ICE_SERVER_LIST = [{ urls: "stun:stun.l.google.com:19302" }];
    const INTERP_NONE = 0;
    const INTERP_LINEAR = 1;
    const INTERP_ANGULAR = 2;
    let isRemovingAllPeers = false;
    const tempArray = [];
    const HANDLER_CLASS = class MultiplayerDOMHandler extends self.DOMHandler {
        constructor(iRuntime) {
            super(iRuntime, DOM_COMPONENT_ID);
            this._iceServers = [];
            this._sigWs = null;
            this._isSignallingConnected = false;
            this._isSignallingLoggedIn = false;
            this._sigservInfo = {
                protocolrev: 0,
                version: 0,
                name: "",
                operator: "",
                motd: "",
            };
            this._myId = "";
            this._myAlias = "";
            this._game = "";
            this._gameInstance = "";
            this._room = "";
            this._allPeers = [];
            this._peersById = new Map();
            this._nextPeerNid = 0;
            this._usedPeerNids = new Set();
            this._selfPeer = null;
            this._hostPeer = null;
            this._clientDelay = 80;
            this._hostUpdateRateSec = 30;
            this._peerUpdateRateSec = 30;
            this._lastUpdateTime = 0;
            this._stats = {
                lastSecondTime: 0,
                outboundPerSec: 0,
                outboundCount: 0,
                outboundBandwidthPerSec: 0,
                outboundBandwidthCount: 0,
                inboundPerSec: 0,
                inboundCount: 0,
                inboundBandwidthPerSec: 0,
                inboundBandwidthCount: 0,
            };
            this._dataBuffer = new ArrayBuffer(262144);
            this._dataView = new DataView(this._dataBuffer);
            this._allRegisteredObjects = [];
            this._nextObjectNid = 1;
            this._registeredObjectsByNid = new Map();
            this._registeredObjectsByRoId = new Map();
            this._simLatency = 0;
            this._simPdv = 0;
            this._simPacketLoss = 0;
            this._lastTimeDiffs = [];
            this._targetHostTimeDiff = 0;
            this._hostTimeDiff = 0;
            this._targetSimDelay = this._clientDelay;
            this._simDelay = this._clientDelay;
            this._allClientValues = [];
            this._clientValuesByTag = new Map();
            this._receivedClientValues = false;
            this._MergeICEServerList(DEFAULT_ICE_SERVER_LIST);
            setInterval(() => this._DoPings(), 2e3);
            window.addEventListener("unload", () => this.RemoveAllPeers("quit"));
            this.AddRuntimeMessageHandler("get-supported", () =>
                this._OnGetSupported()
            );
            this.AddRuntimeMessageHandler("add-ice-servers", (e) =>
                this._MergeICEServerList(e["list"])
            );
            this.AddRuntimeMessageHandler("simulate-latency", (e) =>
                this.SetLatencySimulation(e["latency"], e["pdv"], e["loss"])
            );
            this.AddRuntimeMessageHandler("set-bandwidth-profile", (e) =>
                this.SetBandwidthSettings(e["updateRate"], e["delay"])
            );
            this.AddRuntimeMessageHandler("tick", (e) => this.Tick(e));
            this.AddRuntimeMessageHandler("alert", (e) => this.Alert(e));
            this.AddRuntimeMessageHandler("signalling-connect", (e) =>
                this.SignallingConnect(e["url"])
            );
            this.AddRuntimeMessageHandler("signalling-disconnect", () =>
                this.SignallingDisconnect()
            );
            this.AddRuntimeMessageHandler("signalling-login", (e) =>
                this.SignallingLogin(e["alias"])
            );
            this.AddRuntimeMessageHandler("signalling-join-room", (e) =>
                this.SignallingJoinGameRoom(
                    e["game"],
                    e["instance"],
                    e["room"],
                    e["maxClients"]
                )
            );
            this.AddRuntimeMessageHandler("signalling-auto-join-room", (e) =>
                this.SignallingAutoJoinGameRoom(
                    e["game"],
                    e["instance"],
                    e["room"],
                    e["maxClients"],
                    e["lock"]
                )
            );
            this.AddRuntimeMessageHandler("signalling-leave-room", () =>
                this.SignallingLeaveRoom()
            );
            this.AddRuntimeMessageHandler("signalling-list-game-instances", (e) =>
                this.SignallingRequestGameInstanceList(e["game"])
            );
            this.AddRuntimeMessageHandler("signalling-list-rooms", (e) =>
                this.SignallingRequestRoomList(e["game"], e["instance"], e["which"])
            );
            this.AddRuntimeMessageHandler("disconnect-room", () =>
                this.DisconnectRoom(true)
            );
            this.AddRuntimeMessageHandler("peer-send-message", (e) =>
                this.OnPeerSendMessage(e)
            );
            this.AddRuntimeMessageHandler("host-broadcast", (e) =>
                this.OnHostBroadcast(e)
            );
            this.AddRuntimeMessageHandler("kick-peer", (e) => this.OnKickPeer(e));
            this.AddRuntimeMessageHandler("sync-object", (e) => this.OnSyncObject(e));
            this.AddRuntimeMessageHandler("sync-inst-var", (e) =>
                this.OnSyncInstVar(e)
            );
            this.AddRuntimeMessageHandler("associate-object", (e) =>
                this.OnAssociateObject(e)
            );
            this.AddRuntimeMessageHandler("remove-object-id", (e) =>
                this.RemoveObjectId(e["uid"])
            );
            this.AddRuntimeMessageHandler("remove-net-insts", (e) =>
                this.OnRemoveNetInsts(e)
            );
            this.AddRuntimeMessageHandler("remove-object-nid", (e) =>
                this.OnRemoveObjectNid(e)
            );
            this.AddRuntimeMessageHandler("set-client-state", (e) =>
                this.SetClientState(e["tag"], e["value"])
            );
            this.AddRuntimeMessageHandler("add-client-input-value", (e) =>
                this.AddClientInputValue(e["tag"], e["precision"], e["interp"])
            );
        }
        _GetErrorMessage(err) {
            if (!err) return "unknown error";
            else if (typeof err === "string") return err;
            else if (typeof err["message"] === "string") return err["message"];
            else if (typeof err["details"] === "string") return err["details"];
            else if (typeof err["data"] === "string") return err["data"];
            else if (typeof err["type"] === "string") return err["type"];
            else return "unknown error";
        }
        IsConnected() {
            return this._isSignallingConnected;
        }
        IsLoggedIn() {
            return this.IsConnected() && this._isSignallingLoggedIn;
        }
        IsInRoom() {
            return this.IsLoggedIn() && this._room;
        }
        IsHost() {
            return (
                this.IsInRoom() && this._selfPeer && this._hostPeer === this._selfPeer
            );
        }
        GetMyId() {
            return this.IsLoggedIn() ? this._myId : "";
        }
        GetMyAlias() {
            return this.IsLoggedIn() ? this._myAlias : "";
        }
        GetCurrentGame() {
            return this.IsLoggedIn() ? this._game : "";
        }
        GetCurrentGameInstance() {
            return this.IsLoggedIn() ? this._gameInstance : "";
        }
        GetCurrentRoom() {
            return this.IsInRoom() ? this._room : "";
        }
        GetHostId() {
            return this._hostPeer ? this._hostPeer.GetId() : "";
        }
        GetHostAlias() {
            return this._hostPeer ? this._hostPeer.GetAlias() : "";
        }
        GetHostPeer() {
            return this._hostPeer;
        }
        GetSelfPeer() {
            return this._selfPeer;
        }
        SetLatencySimulation(latency, pdv, loss) {
            this._simLatency = Math.max(latency, 0);
            this._simPdv = Math.max(pdv, 0);
            this._simPacketLoss = Math.max(loss, 0);
        }
        GetSimulatedPacketLoss() {
            return this._simPacketLoss;
        }
        GetSimulatedLatency() {
            return this._simLatency;
        }
        GetSimulatedPdv() {
            return this._simPdv;
        }
        _OnGetSupported() {
            return { isSupported: !!(RTCPeerConnection && RTCDataChannel) };
        }
        SignallingConnect(url) {
            if (this._sigWs || this._isSignallingConnected) return;
            try {
                this._sigWs = new WebSocket(url, SIGNALLING_WEBSOCKET_PROTOCOL);
            } catch (err) {
                this._sigWs = null;
                this._OnSignallingError(err);
                return;
            }
            this._sigWs.onopen = () => {
                if (
                    this._sigWs.protocol.indexOf(SIGNALLING_WEBSOCKET_PROTOCOL) === -1
                ) {
                    this._OnSignallingError(
                        "server does not support '" +
                        SIGNALLING_WEBSOCKET_PROTOCOL +
                        "' protocol"
                    );
                    this._sigWs.close(
                        1002,
                        "'" + SIGNALLING_WEBSOCKET_PROTOCOL + "' protocol required"
                    );
                    this._sigWs = null;
                    this._isSignallingConnected = false;
                    return;
                }
                this._isSignallingConnected = true;
            };
            this._sigWs.onclose = (e) => {
                this._OnSignallingClose();
                this._isSignallingConnected = false;
                this._isSignallingLoggedIn = false;
                this._sigWs = null;
            };
            this._sigWs.onerror = (err) => {
                console.error("Signalling server error: ", err);
                this._OnSignallingError(err);
            };
            this._sigWs.onmessage = (m) => {
                this._OnSignallingMessage(m);
            };
        }
        SignallingDisconnect() {
            if (!this._sigWs || !this._isSignallingConnected) return;
            this._sigWs.close();
            this._sigWs = null;
            this._isSignallingConnected = false;
        }
        _OnSignallingMessage(m) {
            let o;
            try {
                o = JSON.parse(m.data);
            } catch (err) {
                this._OnSignallingError(err);
                return;
            }
            switch (o["message"]) {
                case "welcome":
                    this._OnSignallingReceiveWelcome(o);
                    break;
                case "login-ok":
                    this._OnSignallingReceiveLoginOK(o);
                    break;
                case "join-ok":
                    this._OnSignallingReceiveJoinOK(o);
                    break;
                case "leave-ok":
                    this._OnSignallingReceiveLeaveOK(o);
                    break;
                case "kicked":
                    this._OnSignallingReceiveKicked(o);
                    break;
                case "peer-joined":
                    this._OnSignallingReceivePeerJoined(o);
                    break;
                case "peer-quit":
                    this._OnSignallingReceivePeerQuit(o);
                    break;
                case "icecandidate":
                    this._OnSignallingReceiveIceCandidate(o);
                    break;
                case "offer":
                    this._OnSignallingReceiveOffer(o);
                    break;
                case "answer":
                    this._OnSignallingReceiveAnswer(o);
                    break;
                case "instance-list":
                    this._OnSignallingReceiveInstanceList(o);
                    break;
                case "room-list":
                    this._OnSignallingReceiveRoomList(o);
                    break;
                case "error":
                    this._OnSignallingError(o["details"]);
                    break;
                default:
                    this._OnSignallingError("received unknown signalling message");
                    break;
            }
        }
        HasICEServerUrl(server) {
            for (const s of this._iceServers)
                if (s["urls"] === server["urls"]) return true;
            return false;
        }
        _MergeICEServerList(arr) {
            if (!arr) return;
            for (let o of arr) {
                if (typeof o === "string") o = { urls: o };
                if (!this.HasICEServerUrl(o)) {
                    if (!o.hasOwnProperty("url")) o["url"] = o["urls"];
                    this._iceServers.push(o);
                }
            }
        }
        GetICEServerList() {
            return this._iceServers;
        }
        _OnSignallingError(err) {
            this.PostToRuntime("signalling-error", {
                message: this._GetErrorMessage(err),
            });
        }
        _OnSignallingClose() {
            this.PostToRuntime("signalling-close");
        }
        _OnSignallingReceiveWelcome(o) {
            if (
                o["protocolrev"] < 1 ||
                o["protocolrev"] > SIGNALLING_PROTOCOL_REVISION
            ) {
                this._OnSignallingError(
                    "signalling server protocol revision not supported"
                );
                this.SignallingDisconnect();
                return;
            }
            this._myId = o["clientid"];
            const ssi = this._sigservInfo;
            ssi.protocolrev = o["protocolrev"];
            ssi.version = o["version"];
            ssi.name = o["name"];
            ssi.operator = o["operator"];
            ssi.motd = o["motd"];
            this._MergeICEServerList(o["ice_servers"]);
            this.PostToRuntime("signalling-welcome", {
                myid: this._myId,
                sigservinfo: {
                    protocolrev: ssi.protocolrev,
                    version: ssi.version,
                    name: ssi.name,
                    operator: ssi.operator,
                    motd: ssi.motd,
                },
            });
        }
        _OnSignallingReceiveLoginOK(o) {
            this._myAlias = o["alias"];
            this._isSignallingLoggedIn = true;
            this.PostToRuntime("signalling-login-ok", { myalias: this._myAlias });
        }
        GetNextObjectNid() {
            return this._nextObjectNid++;
        }
        AllocatePeerNid() {
            if (!this.IsHost()) return;
            do {
                this._nextPeerNid++;
                if (this._nextPeerNid > 65535) this._nextPeerNid = 0;
            } while (this._usedPeerNids.has(this._nextPeerNid));
            const nid = this._nextPeerNid;
            this._usedPeerNids.add(nid);
            return nid;
        }
        FreePeerNid(nid) {
            if (!this.IsHost()) return;
            this._usedPeerNids.delete(nid);
        }
        _OnSignallingReceiveJoinOK(o) {
            this.RemoveAllPeers("disconnect");
            this._game = o["game"];
            this._gameInstance = o["instance"];
            this._room = o["room"];
            this._selfPeer = new C3Peer(this, this._myId, this._myAlias);
            if (o["host"]) {
                this._hostPeer = this._selfPeer;
                this._nextPeerNid = 0;
                this._usedPeerNids.clear();
                this._hostPeer._SetNid(this.AllocatePeerNid());
            } else {
                this._lastTimeDiffs.length = 0;
                this._targetHostTimeDiff = 0;
                this._hostTimeDiff = 0;
                this._clientDelay = 80;
                this._hostUpdateRateSec = 30;
                this._peerUpdateRateSec = 30;
                this._targetSimDelay = this._clientDelay;
                this._simDelay = this._clientDelay;
                this._hostPeer = new C3Peer(this, o["hostid"], o["hostalias"]);
                this._hostPeer.Connect();
            }
            this.PostToRuntime("signalling-join-ok", {
                isHost: !!o["host"],
                hostId: this._hostPeer.GetId(),
                hostAlias: this._hostPeer.GetAlias(),
                game: this._game,
                gameInstance: this._gameInstance,
                room: this._room,
            });
        }
        _OnSignallingReceiveLeaveOK(o) {
            this._room = "";
            this.PostToRuntime("signalling-leave-ok");
        }
        _OnSignallingReceiveKicked(o) {
            this.DisconnectRoom();
            this._room = "";
            this.PostToRuntime("signalling-kicked");
        }
        _OnSignallingReceivePeerJoined(o) {
            if (!this._isSignallingLoggedIn || !this._room || !this.IsHost()) return;
            const oldPeer = this._peersById.get(o["peerid"]);
            if (oldPeer) oldPeer.Remove("rejoin");
            const peer = new C3Peer(this, o["peerid"], o["peeralias"]);
            peer.Connect();
        }
        _OnSignallingReceivePeerQuit(o) {
            if (!this._isSignallingLoggedIn || !this._room || !this.IsHost()) return;
            const peer = this._peersById.get(o["id"]);
            if (peer) peer.Remove(o["reason"]);
        }
        _OnSignallingReceiveIceCandidate(o) {
            if (!this._isSignallingLoggedIn || !this._room) return;
            const peer = this._peersById.get(o["from"]);
            if (peer) peer._AddICECandidate(new RTCIceCandidate(o["icecandidate"]));
        }
        _OnSignallingReceiveOffer(o) {
            if (
                !this._isSignallingLoggedIn ||
                !this._room ||
                this.IsHost() ||
                !this._selfPeer ||
                !this._hostPeer ||
                !this._hostPeer.HasPeerConnection()
            )
                return;
            if (o["from"] !== this._hostPeer.GetId()) return;
            const hostPc = this._hostPeer.GetPeerConnection();
            hostPc
                .setRemoteDescription(new RTCSessionDescription(o["offer"]))
                .then(() => {
                    hostPc
                        .createAnswer()
                        .then((answer) => {
                            hostPc.setLocalDescription(answer);
                            this.SignallingSend({
                                message: "answer",
                                toclientid: this._hostPeer.GetId(),
                                answer: answer,
                            });
                        })
                        .catch((err) => {
                            console.error("Peer error creating answer: ", err);
                            this._OnPeerError(
                                this._selfPeer,
                                "could not create answer to host offer"
                            );
                        });
                })
                .catch((err) => {
                    console.error("Peer error setting remote description: ", err);
                    this._OnPeerError(this._selfPeer, "could not set remote description");
                });
        }
        _OnSignallingReceiveAnswer(o) {
            if (!this._isSignallingLoggedIn || !this._room || !this.IsHost()) return;
            const peer = this._peersById.get(o["from"]);
            if (!peer) return;
            peer
                .GetPeerConnection()
                .setRemoteDescription(new RTCSessionDescription(o["answer"]))
                .catch((err) => {
                    console.error("Host error setting remote description: ", err);
                });
        }
        _OnSignallingReceiveInstanceList(o) {
            this.PostToRuntime("signalling-instance-list", { list: o["list"] });
        }
        _OnSignallingReceiveRoomList(o) {
            this.PostToRuntime("signalling-room-list", { list: o["list"] });
        }
        SignallingSend(o) {
            if (this._sigWs && this._isSignallingConnected)
                this._sigWs.send(JSON.stringify(o));
        }
        SignallingLogin(alias) {
            if (this._isSignallingLoggedIn) return;
            this.SignallingSend({
                message: "login",
                protocolrev: SIGNALLING_PROTOCOL_REVISION,
                alias: alias,
            });
        }
        SignallingJoinGameRoom(game, instance, room, maxClients) {
            if (!this._isSignallingLoggedIn || this._room) return;
            this.SignallingSend({
                message: "join",
                game: game,
                instance: instance,
                room: room,
                max_clients: maxClients,
            });
        }
        SignallingAutoJoinGameRoom(game, instance, room, maxClients, lockWhenFull) {
            if (!this._isSignallingLoggedIn || this._room) return;
            this.SignallingSend({
                message: "auto-join",
                game: game,
                instance: instance,
                room: room,
                max_clients: maxClients,
                lock_when_full: lockWhenFull,
            });
        }
        SignallingLeaveRoom() {
            if (!this._isSignallingLoggedIn) return;
            this.SignallingSend({ message: "leave" });
        }
        SignallingConfirmPeer(id) {
            if (!this._isSignallingLoggedIn || !this.IsHost()) return;
            this.SignallingSend({ message: "confirm-peer", id: id });
        }
        SignallingRequestGameInstanceList(game) {
            if (!this._sigWs || !this._isSignallingConnected) return;
            this.SignallingSend({ message: "list-instances", game: game });
        }
        SignallingRequestRoomList(game, instance, which) {
            if (!this._sigWs || !this._isSignallingConnected) return;
            this.SignallingSend({
                message: "list-rooms",
                game: game,
                instance: instance,
                which: which,
            });
        }
        DisconnectRoom(signallingLeaveRoom) {
            this._lastTimeDiffs.length = 0;
            this._targetHostTimeDiff = 0;
            this._hostTimeDiff = 0;
            this.RemoveAllPeers("disconnect");
            for (const ro of this._allRegisteredObjects) ro.ClearAllNetInstances();
            if (signallingLeaveRoom) this.SignallingLeaveRoom();
        }
        _AddPeer(peer) {
            this._allPeers.push(peer);
            this._peersById.set(peer.GetId(), peer);
            this.PostToRuntime("add-peer", {
                id: peer.GetId(),
                alias: peer.GetAlias(),
            });
        }
        _RemovePeer(peer) {
            this.PostToRuntime("remove-peer", { id: peer.GetId() });
            if (this.IsHost()) this.FreePeerNid(peer.GetNid());
            const i = this._allPeers.indexOf(peer);
            if (i > -1) this._allPeers.splice(i, 1);
            this._peersById.delete(peer.GetId());
            if (this._hostPeer === peer) {
                this._hostPeer = null;
                this.RemoveAllPeers("host quit");
            }
            if (this._selfPeer === peer) {
                this._selfPeer = null;
                this._room = "";
                this.RemoveAllPeers("disconnect");
            }
        }
        RemoveAllPeers(reason) {
            if (isRemovingAllPeers) return;
            isRemovingAllPeers = true;
            while (this._allPeers.length) this._allPeers[0].Remove(reason);
            isRemovingAllPeers = false;
        }
        GetPeerById(id) {
            return this._peersById.get(id) || null;
        }
        GetAliasFromId(id) {
            const peer = this._peersById.get(id);
            return peer ? peer.GetAlias() : "";
        }
        GetPeerByNid(nid) {
            for (const p of this._allPeers) if (p.GetNid() === nid) return p;
            return null;
        }
        OnHostBroadcast(e) {
            const fromId = e["fromId"];
            const tag = e["tag"];
            const message = e["message"];
            const mode = e["mode"];
            const skipPeer = this.GetPeerById(fromId);
            this.HostBroadcast(
                mode,
                JSON.stringify({ c: "m", t: tag, f: fromId, m: message }),
                skipPeer
            );
        }
        HostBroadcast(type, m, skipPeer) {
            if (!this.IsHost()) return;
            const peersCopy = this._allPeers.slice(0);
            for (const p of peersCopy) {
                if (!p) continue;
                if (p !== this._selfPeer && p !== skipPeer) p.Send(type, m);
            }
        }
        _DoPings() {
            const nowTime = performance.now();
            if (this.IsHost()) {
                tempArray.push(...this._allPeers);
                for (const p of tempArray) {
                    if (!p) continue;
                    if (p !== this._selfPeer) p.SendPing(nowTime, false);
                }
                tempArray.length = 0;
            } else if (this._hostPeer) this._hostPeer.SendPing(nowTime, false);
        }
        AddRegisteredObject(ro) {
            this._allRegisteredObjects.push(ro);
            this._registeredObjectsByRoId.set(ro.GetRoId(), ro);
            this._registeredObjectsByNid.set(ro.GetNid(), ro);
        }
        GetRegisteredObjectsMap() {
            const ret = {};
            for (const [nid, ro] of this._registeredObjectsByNid.entries())
                ret[ro.GetSid()] = { nid: nid, nvs: ro.GetNetValuesJson() };
            return ret;
        }
        MapObjectNids(objs) {
            this._registeredObjectsByNid.clear();
            for (const ro of this._allRegisteredObjects)
                if (objs.hasOwnProperty(ro.GetSid().toString())) {
                    const o = objs[ro.GetSid().toString()];
                    ro._SetNid(o["nid"]);
                    this._registeredObjectsByNid.set(o["nid"], ro);
                    ro.SetNetValuesFrom(o["nvs"]);
                } else {
                    console.warn(
                        "Could not map object SID '" +
                        ro.GetSid() +
                        "' - host did not send NID for it"
                    );
                    ro._SetNid(-1);
                }
        }
        GetRegisteredObjectByNid(nid) {
            return this._registeredObjectsByNid.get(nid) || null;
        }
        Tick(e) {
            if (!this.IsInRoom()) return null;
            const dt = e["dt"];
            const nowTime = performance.now();
            const updateRate = this.IsHost()
                ? this._hostUpdateRateSec
                : this._peerUpdateRateSec;
            if (nowTime - this._lastUpdateTime >= 1e3 / updateRate - 5) {
                this.SendUpdate(nowTime);
                this._lastUpdateTime = nowTime;
            }
            const stats = this._stats;
            if (nowTime - stats.lastSecondTime >= 1e3) {
                stats.outboundPerSec = stats.outboundCount;
                stats.outboundBandwidthPerSec = stats.outboundBandwidthCount;
                stats.inboundPerSec = stats.inboundCount;
                stats.inboundBandwidthPerSec = stats.inboundBandwidthCount;
                stats.outboundCount = 0;
                stats.outboundBandwidthCount = 0;
                stats.inboundCount = 0;
                stats.inboundBandwidthCount = 0;
                stats.lastSecondTime += 1e3;
                if (nowTime - stats.lastSecondTime > 500)
                    stats.lastSecondTime = nowTime;
                this.PostToRuntime("stats", {
                    stats: {
                        outboundPerSec: stats.outboundPerSec,
                        outboundBandwidthPerSec: stats.outboundBandwidthPerSec,
                        inboundPerSec: stats.inboundPerSec,
                        inboundBandwidthPerSec: stats.inboundBandwidthPerSec,
                    },
                });
            }
            if (!this.IsHost()) {
                if (this._hostTimeDiff < this._targetHostTimeDiff) {
                    this._hostTimeDiff += 10 * dt;
                    if (this._hostTimeDiff > this._targetHostTimeDiff)
                        this._hostTimeDiff = this._targetHostTimeDiff;
                } else if (this._hostTimeDiff > this._targetHostTimeDiff) {
                    this._hostTimeDiff -= 10 * dt;
                    if (this._hostTimeDiff < this._targetHostTimeDiff)
                        this._hostTimeDiff = this._targetHostTimeDiff;
                }
                if (this._simDelay < this._targetSimDelay) {
                    this._simDelay += 30 * dt;
                    if (this._simDelay > this._targetSimDelay)
                        this._simDelay = this._targetSimDelay;
                } else if (this._simDelay > this._targetSimDelay) {
                    this._simDelay -= 30 * dt;
                    if (this._simDelay < this._targetSimDelay)
                        this._simDelay = this._targetSimDelay;
                }
            }
            const simTime = this.GetSimulationTime();
            for (const p of this._allPeers) p.Tick(simTime);
            for (const ro of this._allRegisteredObjects) ro.Tick();
            return {
                simulationTime: this.GetSimulationTime(),
                hostInputArrivalTime: this.GetHostInputArrivalTime(),
                clientDelay: this._clientDelay,
                peerData: this._GetPeerRuntimeData(),
                roData: this._GetRegisteredObjectRuntimeData(),
                isReadyForInput: this.IsReadyForInput(),
            };
        }
        _GetPeerRuntimeData() {
            const ret = {};
            for (const peer of this._allPeers) {
                const clientStateData = {};
                for (const cv of this._allClientValues)
                    clientStateData[cv.GetTag()] = peer.GetInterpClientState(cv);
                ret[peer.GetId()] = {
                    nid: peer.GetNid(),
                    latency: peer.GetLatency(),
                    pdv: peer.GetPdv(),
                    clientState: clientStateData,
                };
            }
            return ret;
        }
        _GetRegisteredObjectRuntimeData() {
            const ret = {};
            for (const ro of this._allRegisteredObjects)
                ret[ro.GetRoId()] = ro.GetRuntimeData();
            return ret;
        }
        async SendUpdate(nowTime) {
            if (this.IsHost()) {
                await this._SendHostUpdate(nowTime);
                this._SendHostEvents(nowTime);
            } else await this._SendClientUpdate(nowTime);
        }
        async _OnBeforeClientUpdate() {
            const result = await this.PostToRuntimeAsync("before-client-update");
            for (const o of result["clientStateUpdates"])
                this.SetClientState(o["tag"], o["value"]);
        }
        async _SendClientUpdate(nowTime) {
            if (this.IsReadyForInput()) await this._OnBeforeClientUpdate();
            if (!this._selfPeer || !this._receivedClientValues) return;
            const dv = this._dataView;
            let ptr = 0;
            const clientValues = this._allClientValues;
            const clientState = this._selfPeer.GetLocalClientState();
            const timeSinceChanged = nowTime - this._selfPeer.GetLastStateChange();
            const timeSinceTransmit = nowTime - this._selfPeer.GetLastStateTransmit();
            let transmit = false;
            if (timeSinceChanged < 100) transmit = true;
            else if (timeSinceChanged < 1e3) transmit = timeSinceTransmit >= 95;
            else transmit = timeSinceTransmit >= 495;
            if (!transmit) return;
            dv.setUint32(ptr, MAGIC_NUMBER);
            ptr += 4;
            dv.setFloat64(ptr, nowTime + this._hostTimeDiff);
            ptr += 8;
            dv.setUint8(ptr, 0);
            ptr += 1;
            dv.setUint8(ptr, clientValues.length);
            ptr += 1;
            for (let i = 0, len = clientValues.length; i < len; ++i) {
                const cv = clientValues[i];
                let value = 0;
                if (i < clientState.length) value = cv.Clamp(clientState[i]);
                ptr = cv.Write(dv, ptr, value);
            }
            this._selfPeer._SetLastStateTransmit(nowTime);
            this._hostPeer.Send("u", new Uint8Array(this._dataBuffer.slice(0, ptr)));
        }
        async _SendHostUpdate(nowTime) {
            const dv = this._dataView;
            let ptr = 0;
            let roToTransmit = 0;
            const objectInfo = await this.PostToRuntimeAsync("get-object-info", {
                ros: this._allRegisteredObjects.map((ro) => ro.GetRuntimeInfoRequest()),
            });
            for (const ro of this._allRegisteredObjects) {
                const roId = ro.GetRoId();
                if (!objectInfo.hasOwnProperty(roId)) continue;
                const instInfo = objectInfo[roId];
                ro.UpdateData(instInfo, nowTime);
                if (ro.GetNumberToTransmit() > 0) roToTransmit++;
            }
            if (roToTransmit === 0) return;
            dv.setUint32(ptr, MAGIC_NUMBER);
            ptr += 4;
            dv.setUint32(ptr, 0);
            ptr += 4;
            dv.setFloat64(ptr, nowTime);
            ptr += 8;
            dv.setUint16(ptr, roToTransmit);
            ptr += 2;
            for (const ro of this._allRegisteredObjects)
                if (ro.GetNumberToTransmit() > 0) ptr = ro.WriteData(dv, ptr, nowTime);
            this.HostBroadcast(
                "u",
                new Uint8Array(this._dataBuffer.slice(0, ptr)),
                null
            );
        }
        _SendHostEvents(nowTime) {
            const dv = this._dataView;
            let ptr = 0;
            let roToTransmit = 0;
            for (const ro of this._allRegisteredObjects)
                if (ro.GetDeadNids().length) roToTransmit++;
            if (roToTransmit === 0) return;
            dv.setUint32(ptr, MAGIC_NUMBER);
            ptr += 4;
            dv.setUint32(ptr, 1);
            ptr += 4;
            dv.setFloat64(ptr, nowTime);
            ptr += 8;
            dv.setUint16(ptr, roToTransmit);
            ptr += 2;
            for (const ro of this._allRegisteredObjects) {
                const deadNids = ro.GetDeadNids();
                if (!deadNids.length) continue;
                dv.setUint16(ptr, ro.GetNid());
                ptr += 2;
                dv.setUint16(ptr, deadNids.length);
                ptr += 2;
                for (const dn of deadNids) {
                    dv.setUint16(ptr, dn);
                    ptr += 2;
                }
                deadNids.length = 0;
            }
            this.HostBroadcast(
                "r",
                new Uint8Array(this._dataBuffer.slice(0, ptr)),
                null
            );
        }
        AddHostTime(hostTime, nowTime, lastLatency, latency) {
            if (this.IsHost()) return;
            this._targetSimDelay = latency + this._clientDelay;
            var timeDiff = hostTime + lastLatency - nowTime;
            if (this._lastTimeDiffs.length === 0) {
                this._hostTimeDiff = timeDiff;
                this._simDelay = this._targetSimDelay;
            }
            this._lastTimeDiffs.push(timeDiff);
            if (this._lastTimeDiffs.length > 30) this._lastTimeDiffs.shift();
            tempArray.push(...this._lastTimeDiffs);
            tempArray.sort((a, b) => a - b);
            let start = 0;
            let end = tempArray.length;
            if (tempArray.length >= 4 && tempArray.length <= 6) {
                ++start;
                --end;
            } else if (tempArray.length > 6 && tempArray.length <= 19) {
                start += 2;
                end -= 2;
            } else if (tempArray.length > 19) {
                start += 5;
                end -= 5;
            }
            let sum = 0;
            for (let i = start; i < end; ++i) sum += tempArray[i];
            this._targetHostTimeDiff = sum / (end - start);
            tempArray.length = 0;
        }
        GetSimulationTime() {
            if (this.IsHost()) return performance.now() - this._clientDelay;
            else return performance.now() + this._hostTimeDiff - this._simDelay;
        }
        GetHostTime() {
            if (this.IsHost()) return performance.now();
            else return performance.now() + this._hostTimeDiff;
        }
        GetHostInputArrivalTime() {
            if (this.IsHost()) return performance.now();
            else return performance.now() + this._hostTimeDiff + this._simDelay;
        }
        SetClientState(tag, x) {
            if (this.IsHost() || !this._selfPeer || !this._receivedClientValues)
                return;
            const cv = this._clientValuesByTag.get(tag);
            if (!cv) return;
            const i = cv.GetIndex();
            const clientState = this._selfPeer.GetLocalClientState();
            if (clientState.length < i + 1) clientState.length = i + 1;
            if (clientState[i] !== x) {
                clientState[i] = x;
                this._selfPeer._SetLastStateChange(performance.now());
            }
        }
        AddClientInputValue(tag, precision, interp) {
            const cv = new C3NetValue(
                this._allClientValues.length,
                interp,
                precision,
                tag,
                null
            );
            this._clientValuesByTag.set(tag, cv);
            this._allClientValues.push(cv);
        }
        GetClientValues() {
            return this._allClientValues;
        }
        GetClientValuesJson() {
            const ret = [];
            for (const cv of this._allClientValues)
                ret.push({
                    tag: cv.GetTag(),
                    precision: cv.GetPrecision(),
                    interp: cv.GetInterp(),
                });
            return ret;
        }
        MapClientValues(arr) {
            this._clientValuesByTag.clear();
            this._allClientValues.length = 0;
            for (let i = 0, len = arr.length; i < len; ++i) {
                const data = arr[i];
                const cv = new C3NetValue(
                    i,
                    data["interp"],
                    data["precision"],
                    data["tag"],
                    null
                );
                this._clientValuesByTag.set(cv.GetTag(), cv);
                this._allClientValues.push(cv);
            }
            this._receivedClientValues = true;
        }
        RemoveObjectId(id) {
            for (const ro of this._allRegisteredObjects) ro.RemoveObjectId(id);
        }
        peers() {
            return this._allPeers;
        }
        GetPeerCount() {
            if (!this.IsInRoom()) return 0;
            return this._allPeers.length;
        }
        GetPeerAt(i) {
            i = Math.floor(i);
            if (!this.IsInRoom() || i < 0 || i >= this._allPeers.length) return null;
            return this._allPeers[i];
        }
        IsReadyForInput() {
            if (!this.IsInRoom()) return false;
            if (this.IsHost()) return true;
            return this._targetHostTimeDiff !== 0;
        }
        SetBandwidthSettings(updateRate, delay) {
            if (this.IsInRoom()) return;
            this._hostUpdateRateSec = updateRate;
            this._peerUpdateRateSec = updateRate;
            this._clientDelay = delay;
        }
        _OnPeerOpen(peer) {
            this.PostToRuntime("peer-open", {
                id: peer.GetId(),
                alias: peer.GetAlias(),
            });
        }
        OnPeerSendMessage(e) {
            const id = e["id"];
            const tag = e["tag"];
            const message = e["message"];
            const mode = e["mode"];
            const peer = this.GetPeerById(id);
            if (!peer) return;
            peer.Send(mode, JSON.stringify({ c: "m", t: tag, m: message }));
        }
        _OnPeerClose(peer, reason) {
            this.PostToRuntime("peer-close", {
                id: peer.GetId(),
                alias: peer.GetAlias(),
                reason: reason || "unknown",
            });
        }
        _OnPeerError(peer, err) {
            console.error(
                `[Multiplayer] Peer '${peer.GetAlias()}' (${peer.GetId()}) error: `,
                err
            );
        }
        _OnPeerMessage(peer, m) {
            const senderPeerId = m["f"] || peer.GetId();
            this.PostToRuntime("peer-message", {
                tag: m["t"],
                fromId: senderPeerId,
                fromAlias: this.GetAliasFromId(senderPeerId),
                content: m["m"],
            });
        }
        _OnInstanceDestroyed(ro, nid, timestamp) {
            this.PostToRuntime("instance-destroyed", {
                roId: ro.GetRoId(),
                nid: nid,
                timestamp: timestamp,
            });
        }
        OnKickPeer(e) {
            if (!this.IsHost()) return;
            const id = e["id"];
            const reason = e["reason"];
            const peer = this.GetPeerById(id);
            if (!peer) return;
            peer.Remove(reason, true);
        }
        StatIncOutboundCount() {
            this._stats.outboundCount++;
        }
        StatAddOutboundBandwidthCount(size) {
            this._stats.outboundBandwidthCount += size;
        }
        StatIncInboundCount() {
            this._stats.inboundCount++;
        }
        StatAddInboundBandwidthCount(size) {
            this._stats.inboundBandwidthCount += size;
        }
        SetClientDelay(d) {
            this._clientDelay = d;
        }
        GetClientDelay() {
            return this._clientDelay;
        }
        SetPeerUpdateRateSec(r) {
            this._peerUpdateRateSec = r;
        }
        GetPeerUpdateRateSec() {
            return this._peerUpdateRateSec;
        }
        OnSyncObject(e) {
            const data = e["data"];
            const precision = e["precision"];
            const bandwidth = e["bandwidth"];
            for (const ocData of e["objectClasses"]) {
                const ro = new self.C3RegisteredObject(
                    this,
                    ocData["roId"],
                    ocData["sid"],
                    bandwidth
                );
                if (data === 1) {
                    ro.AddValue(INTERP_LINEAR, precision, "x");
                    ro.AddValue(INTERP_LINEAR, precision, "y");
                } else if (data === 2) ro.AddValue(INTERP_ANGULAR, precision, "a");
                else if (data === 3) {
                    ro.AddValue(INTERP_LINEAR, precision, "x");
                    ro.AddValue(INTERP_LINEAR, precision, "y");
                    ro.AddValue(INTERP_ANGULAR, precision, "a");
                }
            }
        }
        Alert(e) {
            alert(e["message"]);
        }
        OnSyncInstVar(e) {
            const precision = e["precision"];
            const interp = e["interp"];
            const clientValueTag = e["cvt"];
            for (const data of e["syncData"]) {
                const ro = this._registeredObjectsByRoId.get(data["roId"]);
                ro.AddValue(interp, precision, "iv", data["varIndex"], clientValueTag);
            }
        }
        OnAssociateObject(e) {
            const roId = e["roId"];
            const peerId = e["peerId"];
            const instUid = e["instUid"];
            const ro = this._registeredObjectsByRoId.get(roId);
            const peer = this._peersById.get(peerId);
            if (!ro || !peer) return;
            if (this.IsHost()) ro.OverrideNid(instUid, peer.GetNid());
        }
        OnRemoveNetInsts(e) {
            for (const [roId, toRemove] of Object.entries(e)) {
                const ro = this._registeredObjectsByRoId.get(parseInt(roId, 10));
                if (!ro) continue;
                for (const nid of toRemove) ro.RemoveObjectNid(nid);
            }
        }
        OnRemoveObjectNid(e) {
            const roId = e["roId"];
            const nid = e["nid"];
            const ro = this._registeredObjectsByRoId.get(roId);
            if (ro) ro.RemoveObjectNid(nid);
        }
    };
    self.RuntimeInterface.AddDOMHandlerClass(HANDLER_CLASS);
}
("use strict");
{
    const DOM_COMPONENT_ID = "share";
    function IsWebShareFilesSupported() {
        const FileCtor = self["RealFile"] || self["File"];
        return (
            typeof navigator["canShare"] === "function" &&
            navigator["canShare"]({
                files: [new FileCtor(["test file"], "test.txt", {})],
            })
        );
    }
    const HANDLER_CLASS = class ShareHandler extends self.DOMHandler {
        constructor(iRuntime) {
            super(iRuntime, DOM_COMPONENT_ID);
            const hasCordovaPlugin = !!this._GetSharePlugin();
            this._isWebShareSupported = typeof navigator["share"] === "function";
            this._isSupported = this._isWebShareSupported || hasCordovaPlugin;
            this._isWebShareFilesSupported = IsWebShareFilesSupported();
            this._isFilesSupported =
                this._isWebShareFilesSupported || hasCordovaPlugin;
            this.AddRuntimeMessageHandlers([
                ["init", (e) => this._OnInit(e)],
                ["share", (e) => this._OnShare(e)],
                ["request-rate", (e) => this._OnRateApp(e)],
                ["request-store", (e) => this._OnShowStore(e)],
            ]);
        }
        _OnInit() {
            return {
                isSupported: this._isSupported,
                isFilesSupported: this._isFilesSupported,
            };
        }
        _GetSharePlugin() {
            return window["plugins"] && window["plugins"]["socialsharing"];
        }
        _GetRatePlugin() {
            return (
                window["cordova"] &&
                window["cordova"]["plugins"] &&
                window["cordova"]["plugins"]["RateApp"]
            );
        }
        async _OnShare(e) {
            const text = e["text"];
            const title = e["title"];
            const url = e["url"];
            const filesArr = e["files"].slice(0);
            const hasFiles = filesArr.length > 0;
            const plugin = this._GetSharePlugin();
            const useWebShare = !plugin;
            if (useWebShare) {
                const opts = {};
                if (text) opts["text"] = text;
                if (title) opts["title"] = title;
                if (url) opts["url"] = url;
                if (hasFiles) opts["files"] = filesArr;
                try {
                    await navigator["share"](opts);
                    this.PostToRuntime("share-completed");
                } catch (err) {
                    console.log("[Share plugin] Share failed: ", err);
                    this.PostToRuntime("share-failed");
                }
            } else {
                const opts = {};
                if (text) opts["message"] = text;
                if (title) opts["subject"] = title;
                if (url) opts["url"] = url;
                if (hasFiles) {
                    let totalSize = 0;
                    for (const f of filesArr) totalSize += f.size;
                    try {
                        const tempDirEntry = await this._CordovaGetTempDirEntry(
                            Math.floor(totalSize * 1.25)
                        );
                        opts["files"] = await Promise.all(
                            filesArr.map((f) => this._CordovaWriteTempFile(f, tempDirEntry))
                        );
                    } catch (err) {
                        console.log("[Share plugin] Share failed: ", err);
                        this.PostToRuntime("share-failed");
                        return;
                    }
                }
                plugin["shareWithOptions"](
                    opts,
                    () => {
                        this.PostToRuntime("share-completed");
                    },
                    (err) => {
                        console.log("[Share plugin] Share failed: ", err);
                        this.PostToRuntime("share-failed");
                    }
                );
            }
        }
        _OnRateApp(e) {
            const body = e["body"];
            const confirm = e["confirm"];
            const cancel = e["cancel"];
            const appID = e["appID"];
            const plugin = this._GetRatePlugin();
            if (plugin) plugin["Rate"](body, confirm, cancel, appID);
        }
        _OnShowStore(e) {
            const appID = e["appID"];
            const plugin = this._GetRatePlugin();
            if (plugin) plugin["Store"](appID);
        }
        _CordovaGetTempDirEntry(quotaSize) {
            return new Promise((resolve, reject) => {
                window["requestFileSystem"](
                    window["TEMPORARY"],
                    quotaSize,
                    (fs) => resolve(fs["root"]),
                    reject
                );
            });
        }
        _CordovaWriteTempFile(file, dirEntry) {
            return new Promise((resolve, reject) => {
                dirEntry["getFile"](
                    file.name,
                    { create: true, exclusive: false },
                    (fileEntry) => {
                        const fileUrl = fileEntry["toURL"]();
                        fileEntry["createWriter"]((fileWriter) => {
                            fileWriter["onwriteend"] = () => resolve(fileUrl);
                            fileWriter["onerror"] = reject;
                            fileWriter["write"](file);
                        });
                    },
                    reject
                );
            });
        }
    };
    self.RuntimeInterface.AddDOMHandlerClass(HANDLER_CLASS);
}
("use strict");
{
    const DOM_COMPONENT_ID = "advert";
    const USE_EMULATOR = false;
    let hasShownWarning = false;
    const pluginEmulator = {};
    {
        const STATUS_PERSONALISED = "PERSONALIZED";
        const addHandler = (name, fn) => {
            pluginEmulator[name] = fn;
        };
        const sleep = (t) => new Promise((r) => setTimeout(r, t));
        let bannerState = null;
        let intState = null;
        let videoState = null;
        function getArgument(name, a) {
            const args = a.slice(0, -1);
            const fn = a[a.length - 1];
            console.log(name, args);
            return [args, fn];
        }
        addHandler("CreateBannerAdvert", async (...a) => {
            const [data, fn] = getArgument("CreateBannerAdvert", a);
            await sleep(50);
            if (bannerState) fn("Banner already exists");
            else {
                bannerState = "ready";
                fn(null, "Created banner");
            }
        });
        addHandler("ShowBannerAdvert", async (...a) => {
            const [data, fn] = getArgument("ShowBannerAdvert", a);
            await sleep(50);
            if (bannerState != "ready") fn("Banner cannot be shown");
            else {
                bannerState = "shown";
                fn(null, "Showed banner");
            }
        });
        addHandler("HideBannerAdvert", async (...a) => {
            const [data, fn] = getArgument("HideBannerAdvert", a);
            await sleep(50);
            if (bannerState != "shown") fn("Banner cannot be hidden");
            else {
                bannerState = null;
                fn(null, "Hid banner");
            }
        });
        addHandler("CreateInterstitialAdvert", async (...a) => {
            const [data, fn] = getArgument("CreateInterstitialAdvert", a);
            await sleep(50);
            if (intState) fn("Intersitial already exists");
            else {
                intState = "ready";
                fn(null, "Created interstitial");
            }
        });
        addHandler("ShowInterstitialAdvert", async (...a) => {
            const [data, fn] = getArgument("ShowInterstitialAdvert", a);
            await sleep(50);
            if (intState != "ready") fn("Cannot show interstitial");
            else {
                intState = null;
                fn(null, "Interstitial shown");
            }
        });
        addHandler("CreateVideoAdvert", async (...a) => {
            const [data, fn] = getArgument("CreateVideoAdvert", a);
            await sleep(50);
            if (videoState) fn("Video already exists");
            else {
                videoState = "ready";
                fn(null, "Created video");
            }
        });
        addHandler("ShowVideoAdvert", async (...a) => {
            const [data, fn] = getArgument("ShowVideoAdvert", a);
            await sleep(50);
            if (videoState != "ready") fn("Cannot show video");
            else {
                videoState = null;
                fn(null, '["example type", 20]');
            }
        });
        addHandler("Configure", async (...a) => {
            const [data, fn] = getArgument("Configure", a);
            await sleep(50);
            fn(null, STATUS_PERSONALISED + "_true");
        });
        addHandler("RequestConsent", async (...a) => {
            const [data, fn] = getArgument("RequestConsent", a);
            await sleep(50);
            fn(null, STATUS_PERSONALISED + "_true");
        });
        addHandler("SetUserPersonalisation", async (...a) => {
            const [data, fn] = getArgument("SetUserPersonalisation", a);
            await sleep(50);
            fn(null, data[0] + "_true");
        });
        addHandler("RequestIDFA", async (...a) => {
            const [data, fn] = getArgument("RequestIDFA", a);
            await sleep(50);
            fn(null, "authorized");
        });
    }
    const HANDLER_CLASS = class MobileAdvertHandler extends self.DOMHandler {
        constructor(iRuntime) {
            super(iRuntime, DOM_COMPONENT_ID);
            const handler = (name) => [name, (data) => this._CallMethod(name, data)];
            this.AddRuntimeMessageHandlers([
                handler("CreateBannerAdvert"),
                handler("ShowBannerAdvert"),
                handler("HideBannerAdvert"),
                handler("CreateInterstitialAdvert"),
                handler("ShowInterstitialAdvert"),
                handler("CreateVideoAdvert"),
                handler("ShowVideoAdvert"),
                handler("Configure"),
                handler("RequestConsent"),
                handler("SetUserPersonalisation"),
                handler("SetMaxAdContentRating"),
                handler("TagForChildDirectedTreatment"),
                handler("TagForUnderAgeOfConsent"),
                handler("RequestIDFA"),
            ]);
        }
        _GetPlugin() {
            if (window["cordova"]) return window["cordova"]["plugins"]["ConstructAd"];
            else if (USE_EMULATOR) return pluginEmulator;
        }
        async _CallMethod(name, data) {
            const ad = this._GetPlugin();
            if (!ad) {
                if (!hasShownWarning) {
                    hasShownWarning = true;
                    console.warn(
                        "The Mobile Advert plugin is not loaded. Please note that it only works in Android or iOS exports"
                    );
                }
                throw new Error("advert plugin not loaded");
            }
            return new Promise((res, rej) => {
                ad[name](...data, (err, result) => {
                    if (err) rej(err);
                    else res(result);
                });
            });
        }
    };
    self.RuntimeInterface.AddDOMHandlerClass(HANDLER_CLASS);
}
("use strict");
{
    const DOM_COMPONENT_ID = "touch";
    const HANDLER_CLASS = class TouchDOMHandler extends self.DOMHandler {
        constructor(iRuntime) {
            super(iRuntime, DOM_COMPONENT_ID);
            this.AddRuntimeMessageHandler("request-permission", (e) =>
                this._OnRequestPermission(e)
            );
        }
        async _OnRequestPermission(e) {
            const type = e["type"];
            let result = true;
            if (type === 0) result = await this._RequestOrientationPermission();
            else if (type === 1) result = await this._RequestMotionPermission();
            this.PostToRuntime("permission-result", { type: type, result: result });
        }
        async _RequestOrientationPermission() {
            if (
                !self["DeviceOrientationEvent"] ||
                !self["DeviceOrientationEvent"]["requestPermission"]
            )
                return true;
            try {
                const state = await self["DeviceOrientationEvent"][
                    "requestPermission"
                    ]();
                return state === "granted";
            } catch (err) {
                console.warn("[Touch] Failed to request orientation permission: ", err);
                return false;
            }
        }
        async _RequestMotionPermission() {
            if (
                !self["DeviceMotionEvent"] ||
                !self["DeviceMotionEvent"]["requestPermission"]
            )
                return true;
            try {
                const state = await self["DeviceMotionEvent"]["requestPermission"]();
                return state === "granted";
            } catch (err) {
                console.warn("[Touch] Failed to request motion permission: ", err);
                return false;
            }
        }
    };
    self.RuntimeInterface.AddDOMHandlerClass(HANDLER_CLASS);
}
("use strict");
{
    const DOM_COMPONENT_ID = "platform-info";
    const HANDLER_CLASS = class PlatformInfoDOMHandler extends self.DOMHandler {
        constructor(iRuntime) {
            super(iRuntime, DOM_COMPONENT_ID);
            this.AddRuntimeMessageHandlers([
                ["get-initial-state", () => this._OnGetInitialState()],
                ["request-wake-lock", () => this._OnRequestWakeLock()],
                ["release-wake-lock", () => this._OnReleaseWakeLock()],
            ]);
            window.addEventListener("resize", () => this._OnResize());
            this._screenWakeLock = null;
        }
        _OnGetInitialState() {
            return {
                screenWidth: screen.width,
                screenHeight: screen.height,
                windowOuterWidth: window.outerWidth,
                windowOuterHeight: window.outerHeight,
                safeAreaInset: this._GetSafeAreaInset(),
                supportsWakeLock: !!navigator["wakeLock"],
            };
        }
        _GetSafeAreaInset() {
            const elem = document.body;
            const elemStyle = elem.style;
            elemStyle.setProperty("--temp-sai-top", "env(safe-area-inset-top)");
            elemStyle.setProperty("--temp-sai-right", "env(safe-area-inset-right)");
            elemStyle.setProperty("--temp-sai-bottom", "env(safe-area-inset-bottom)");
            elemStyle.setProperty("--temp-sai-left", "env(safe-area-inset-left)");
            const computedStyle = getComputedStyle(elem);
            const ret = [
                computedStyle.getPropertyValue("--temp-sai-top"),
                computedStyle.getPropertyValue("--temp-sai-right"),
                computedStyle.getPropertyValue("--temp-sai-bottom"),
                computedStyle.getPropertyValue("--temp-sai-left"),
            ].map((str) => {
                const n = parseInt(str, 10);
                return isFinite(n) ? n : 0;
            });
            elemStyle.removeProperty("--temp-sai-top");
            elemStyle.removeProperty("--temp-sai-right");
            elemStyle.removeProperty("--temp-sai-bottom");
            elemStyle.removeProperty("--temp-sai-left");
            return ret;
        }
        _OnResize() {
            this.PostToRuntime("window-resize", {
                windowOuterWidth: window.outerWidth,
                windowOuterHeight: window.outerHeight,
                safeAreaInset: this._GetSafeAreaInset(),
            });
        }
        async _OnRequestWakeLock() {
            if (this._screenWakeLock) return;
            try {
                this._screenWakeLock = await navigator["wakeLock"]["request"]("screen");
                this._screenWakeLock.addEventListener("release", () =>
                    this._OnWakeLockReleased()
                );
                console.log("[Construct 3] Screen wake lock acquired");
                this.PostToRuntime("wake-lock-acquired");
            } catch (err) {
                console.warn("[Construct 3] Failed to acquire screen wake lock: ", err);
                this.PostToRuntime("wake-lock-error");
            }
        }
        _OnReleaseWakeLock() {
            if (!this._screenWakeLock) return;
            this._screenWakeLock["release"]();
            this._screenWakeLock = null;
        }
        _OnWakeLockReleased() {
            console.log("[Construct 3] Screen wake lock released");
            this._screenWakeLock = null;
            this.PostToRuntime("wake-lock-released");
        }
    };
    self.RuntimeInterface.AddDOMHandlerClass(HANDLER_CLASS);
}
("use strict");
{
    const DOM_COMPONENT_ID = "mobileiap";
    function Log(str) {
        console.log("[C3 IAP]", str);
    }
    const HANDLER_CLASS = class IAPDOMHandler extends self.DOMHandler {
        constructor(iRuntime) {
            super(iRuntime, DOM_COMPONENT_ID);
            this._store = null;
            this._products = [];
            this._pendingProducts = new Set();
            this._lastError = null;
            this.AddRuntimeMessageHandler("init", (e) => this._Initialise(e));
            this.AddRuntimeMessageHandler("register", (o) => this._OnRegister(o));
            this.AddRuntimeMessageHandler("complete_registration", (_) =>
                this._OnCompleteRegistration()
            );
            this.AddRuntimeMessageHandler("purchase", (id) => this._OnPurchase(id));
            this.AddRuntimeMessageHandler("restore", (_) => this._OnRestore());
        }
        _Initialise(e) {
            Log("Initialising");
            this._store = window["store"];
            if (!this._store) return;
            const validatorUrl = e["validator-url"];
            if (validatorUrl) this._store["validator"] = validatorUrl;
            this._store["ready"]((_) => this._OnReady());
            this._store["error"]((err) => this._OnGenericError(err));
            this._When("valid", (product) => this._OnProductAvailable(product));
            this._When("approved", (product) => this._OnProductApproved(product));
            this._When("verified", (product) => this._OnProductVerified(product));
            this._When("finished", (product) => this._OnPurchaseSuccess(product));
            this._When("owned", (product) => this._OnProductOwned(product));
            this._When("error", (err, product) => this._OnPurchaseFail(product, err));
        }
        _When(verb, callback) {
            this._store["when"]("product")[verb](callback);
        }
        _OnReady() {
            Log("store ready");
            const products = [...this._store["products"]];
            this.PostToRuntime("registration", products);
        }
        _OnProductApproved(product) {
            Log(`product "${product["alias"]}" approved, verifying`);
            product["verify"]();
        }
        _OnProductVerified(product) {
            Log(`product "${product["alias"]}" verified, finishing`);
            product["finish"]();
        }
        _OnProductAvailable(product) {
            if (this._pendingProducts.has(product["id"]))
                this._OnPurchaseFail(product, this._lastError);
            this.PostToRuntime("product-available", product);
        }
        _OnProductOwned(product) {
            this.PostToRuntime("product-owned", product);
        }
        _OnPurchaseSuccess(product) {
            this._pendingProducts.delete(product["id"]);
            this.PostToRuntime("purchase-success", product);
        }
        _OnPurchaseFail(product, err) {
            this.PostToRuntime("purchase-failure", [product, err]);
        }
        _OnGenericError(err) {
            this._lastError = err;
            Log(err);
        }
        _OnRegister(o) {
            const id = o["id"];
            const type = o["type"];
            if (!this._store) return null;
            this._products.push({ id: id, alias: id, type: this._store[type] });
        }
        _OnCompleteRegistration() {
            if (!this._store) return;
            for (const product of this._products) {
                Log(`Registering product "${product["alias"]}"`);
                this._store["register"](product);
            }
            this._store["refresh"]();
        }
        _OnPurchase(id) {
            if (!this._store) return;
            const product = this._store["get"](id);
            if (!product["valid"]) {
                const err = { code: -1, message: "Unable to purchase invalid product" };
                this.PostToRuntime("purchase-failure", [product, err]);
                return;
            }
            this._pendingProducts.add(id);
            Log(`Purchasing product "${id}"`);
            this._store["order"](id);
        }
        _OnRestore() {
            if (!this._store) return;
            this._store["refresh"]();
        }
    };
    self.RuntimeInterface.AddDOMHandlerClass(HANDLER_CLASS);
}
("use strict");
{
    const R_TO_D = 180 / Math.PI;
    const DOM_COMPONENT_ID = "audio";
    self.AudioDOMHandler = class AudioDOMHandler extends self.DOMHandler {
        constructor(iRuntime) {
            super(iRuntime, DOM_COMPONENT_ID);
            this._audioContext = null;
            this._destinationNode = null;
            this._hasUnblocked = false;
            this._hasAttachedUnblockEvents = false;
            this._unblockFunc = () => this._UnblockAudioContext();
            this._audioBuffers = [];
            this._audioInstances = [];
            this._lastAudioInstance = null;
            this._lastPlayedTag = "";
            this._lastTickCount = -1;
            this._pendingTags = new Map();
            this._masterVolume = 1;
            this._isSilent = false;
            this._timeScaleMode = 0;
            this._timeScale = 1;
            this._gameTime = 0;
            this._panningModel = "HRTF";
            this._distanceModel = "inverse";
            this._refDistance = 600;
            this._maxDistance = 1e4;
            this._rolloffFactor = 1;
            this._playMusicAsSound = false;
            this._hasAnySoftwareDecodedMusic = false;
            this._supportsWebMOpus = this._iRuntime.IsAudioFormatSupported(
                "audio/webm; codecs=opus"
            );
            this._effects = new Map();
            this._analysers = new Set();
            this._isPendingPostFxState = false;
            this._microphoneTag = "";
            this._microphoneSource = null;
            self["C3Audio_OnMicrophoneStream"] = (localMediaStream, tag) =>
                this._OnMicrophoneStream(localMediaStream, tag);
            this._destMediaStreamNode = null;
            self["C3Audio_GetOutputStream"] = () => this._OnGetOutputStream();
            self["C3Audio_DOMInterface"] = this;
            this.AddRuntimeMessageHandlers([
                ["create-audio-context", (e) => this._CreateAudioContext(e)],
                ["play", (e) => this._Play(e)],
                ["stop", (e) => this._Stop(e)],
                ["stop-all", () => this._StopAll()],
                ["set-paused", (e) => this._SetPaused(e)],
                ["set-volume", (e) => this._SetVolume(e)],
                ["fade-volume", (e) => this._FadeVolume(e)],
                ["set-master-volume", (e) => this._SetMasterVolume(e)],
                ["set-muted", (e) => this._SetMuted(e)],
                ["set-silent", (e) => this._SetSilent(e)],
                ["set-looping", (e) => this._SetLooping(e)],
                ["set-playback-rate", (e) => this._SetPlaybackRate(e)],
                ["seek", (e) => this._Seek(e)],
                ["preload", (e) => this._Preload(e)],
                ["unload", (e) => this._Unload(e)],
                ["unload-all", () => this._UnloadAll()],
                ["set-suspended", (e) => this._SetSuspended(e)],
                ["add-effect", (e) => this._AddEffect(e)],
                ["set-effect-param", (e) => this._SetEffectParam(e)],
                ["remove-effects", (e) => this._RemoveEffects(e)],
                ["tick", (e) => this._OnTick(e)],
                ["load-state", (e) => this._OnLoadState(e)],
            ]);
        }
        async _CreateAudioContext(e) {
            if (e["isiOSCordova"]) this._playMusicAsSound = true;
            this._timeScaleMode = e["timeScaleMode"];
            this._panningModel = ["equalpower", "HRTF", "soundfield"][
                e["panningModel"]
                ];
            this._distanceModel = ["linear", "inverse", "exponential"][
                e["distanceModel"]
                ];
            this._refDistance = e["refDistance"];
            this._maxDistance = e["maxDistance"];
            this._rolloffFactor = e["rolloffFactor"];
            const opts = { latencyHint: e["latencyHint"] };
            if (!this.SupportsWebMOpus()) opts["sampleRate"] = 48e3;
            if (typeof AudioContext !== "undefined")
                this._audioContext = new AudioContext(opts);
            else if (typeof webkitAudioContext !== "undefined")
                this._audioContext = new webkitAudioContext(opts);
            else throw new Error("Web Audio API not supported");
            this._AttachUnblockEvents();
            this._audioContext.onstatechange = () => {
                if (this._audioContext.state !== "running") this._AttachUnblockEvents();
            };
            this._destinationNode = this._audioContext["createGain"]();
            this._destinationNode["connect"](this._audioContext["destination"]);
            const listenerPos = e["listenerPos"];
            this._audioContext["listener"]["setPosition"](
                listenerPos[0],
                listenerPos[1],
                listenerPos[2]
            );
            this._audioContext["listener"]["setOrientation"](0, 0, 1, 0, -1, 0);
            self["C3_GetAudioContextCurrentTime"] = () => this.GetAudioCurrentTime();
            try {
                await Promise.all(
                    e["preloadList"].map((o) =>
                        this._GetAudioBuffer(o["originalUrl"], o["url"], o["type"], false)
                    )
                );
            } catch (err) {
                console.error("[Construct 3] Preloading sounds failed: ", err);
            }
            return { sampleRate: this._audioContext["sampleRate"] };
        }
        _AttachUnblockEvents() {
            if (this._hasAttachedUnblockEvents) return;
            this._hasUnblocked = false;
            window.addEventListener("pointerup", this._unblockFunc, true);
            window.addEventListener("touchend", this._unblockFunc, true);
            window.addEventListener("click", this._unblockFunc, true);
            window.addEventListener("keydown", this._unblockFunc, true);
            this._hasAttachedUnblockEvents = true;
        }
        _DetachUnblockEvents() {
            if (!this._hasAttachedUnblockEvents) return;
            this._hasUnblocked = true;
            window.removeEventListener("pointerup", this._unblockFunc, true);
            window.removeEventListener("touchend", this._unblockFunc, true);
            window.removeEventListener("click", this._unblockFunc, true);
            window.removeEventListener("keydown", this._unblockFunc, true);
            this._hasAttachedUnblockEvents = false;
        }
        _UnblockAudioContext() {
            if (this._hasUnblocked) return;
            const audioContext = this._audioContext;
            if (audioContext["state"] === "suspended" && audioContext["resume"])
                audioContext["resume"]();
            const buffer = audioContext["createBuffer"](1, 220, 22050);
            const source = audioContext["createBufferSource"]();
            source["buffer"] = buffer;
            source["connect"](audioContext["destination"]);
            source["start"](0);
            if (audioContext["state"] === "running") this._DetachUnblockEvents();
        }
        GetAudioContext() {
            return this._audioContext;
        }
        GetAudioCurrentTime() {
            return this._audioContext["currentTime"];
        }
        GetDestinationNode() {
            return this._destinationNode;
        }
        GetDestinationForTag(tag) {
            const fxChain = this._effects.get(tag.toLowerCase());
            if (fxChain) return fxChain[0].GetInputNode();
            else return this.GetDestinationNode();
        }
        AddEffectForTag(tag, effect) {
            tag = tag.toLowerCase();
            let fxChain = this._effects.get(tag);
            if (!fxChain) {
                fxChain = [];
                this._effects.set(tag, fxChain);
            }
            effect._SetIndex(fxChain.length);
            effect._SetTag(tag);
            fxChain.push(effect);
            this._ReconnectEffects(tag);
        }
        _ReconnectEffects(tag) {
            let destNode = this.GetDestinationNode();
            const fxChain = this._effects.get(tag);
            if (fxChain && fxChain.length) {
                destNode = fxChain[0].GetInputNode();
                for (let i = 0, len = fxChain.length; i < len; ++i) {
                    const n = fxChain[i];
                    if (i + 1 === len) n.ConnectTo(this.GetDestinationNode());
                    else n.ConnectTo(fxChain[i + 1].GetInputNode());
                }
            }
            for (const ai of this.audioInstancesByTag(tag)) ai.Reconnect(destNode);
            if (this._microphoneSource && this._microphoneTag === tag) {
                this._microphoneSource["disconnect"]();
                this._microphoneSource["connect"](destNode);
            }
        }
        GetMasterVolume() {
            return this._masterVolume;
        }
        IsSilent() {
            return this._isSilent;
        }
        GetTimeScaleMode() {
            return this._timeScaleMode;
        }
        GetTimeScale() {
            return this._timeScale;
        }
        GetGameTime() {
            return this._gameTime;
        }
        IsPlayMusicAsSound() {
            return this._playMusicAsSound;
        }
        SupportsWebMOpus() {
            return this._supportsWebMOpus;
        }
        _SetHasAnySoftwareDecodedMusic() {
            this._hasAnySoftwareDecodedMusic = true;
        }
        GetPanningModel() {
            return this._panningModel;
        }
        GetDistanceModel() {
            return this._distanceModel;
        }
        GetReferenceDistance() {
            return this._refDistance;
        }
        GetMaxDistance() {
            return this._maxDistance;
        }
        GetRolloffFactor() {
            return this._rolloffFactor;
        }
        DecodeAudioData(audioData, needsSoftwareDecode) {
            if (needsSoftwareDecode)
                return this._iRuntime
                    ._WasmDecodeWebMOpus(audioData)
                    .then((rawAudio) => {
                        const audioBuffer = this._audioContext["createBuffer"](
                            1,
                            rawAudio.length,
                            48e3
                        );
                        const channelBuffer = audioBuffer["getChannelData"](0);
                        channelBuffer.set(rawAudio);
                        return audioBuffer;
                    });
            else
                return new Promise((resolve, reject) => {
                    this._audioContext["decodeAudioData"](audioData, resolve, reject);
                });
        }
        TryPlayMedia(mediaElem) {
            this._iRuntime.TryPlayMedia(mediaElem);
        }
        RemovePendingPlay(mediaElem) {
            this._iRuntime.RemovePendingPlay(mediaElem);
        }
        ReleaseInstancesForBuffer(buffer) {
            let j = 0;
            for (let i = 0, len = this._audioInstances.length; i < len; ++i) {
                const a = this._audioInstances[i];
                this._audioInstances[j] = a;
                if (a.GetBuffer() === buffer) a.Release();
                else ++j;
            }
            this._audioInstances.length = j;
        }
        ReleaseAllMusicBuffers() {
            let j = 0;
            for (let i = 0, len = this._audioBuffers.length; i < len; ++i) {
                const b = this._audioBuffers[i];
                this._audioBuffers[j] = b;
                if (b.IsMusic()) b.Release();
                else ++j;
            }
            this._audioBuffers.length = j;
        }
        *audioInstancesByTag(tag) {
            if (tag)
                for (const ai of this._audioInstances) {
                    if (self.AudioDOMHandler.EqualsNoCase(ai.GetTag(), tag)) yield ai;
                }
            else if (this._lastAudioInstance && !this._lastAudioInstance.HasEnded())
                yield this._lastAudioInstance;
        }
        async _GetAudioBuffer(originalUrl, url, type, isMusic, dontCreate) {
            for (const ab of this._audioBuffers)
                if (ab.GetUrl() === url) {
                    await ab.Load();
                    return ab;
                }
            if (dontCreate) return null;
            if (
                isMusic &&
                (this._playMusicAsSound || this._hasAnySoftwareDecodedMusic)
            )
                this.ReleaseAllMusicBuffers();
            const ret = self.C3AudioBuffer.Create(
                this,
                originalUrl,
                url,
                type,
                isMusic
            );
            this._audioBuffers.push(ret);
            await ret.Load();
            return ret;
        }
        async _GetAudioInstance(originalUrl, url, type, tag, isMusic) {
            for (const ai of this._audioInstances)
                if (ai.GetUrl() === url && (ai.CanBeRecycled() || isMusic)) {
                    ai.SetTag(tag);
                    return ai;
                }
            const buffer = await this._GetAudioBuffer(
                originalUrl,
                url,
                type,
                isMusic
            );
            const ret = buffer.CreateInstance(tag);
            this._audioInstances.push(ret);
            return ret;
        }
        _AddPendingTag(tag) {
            let info = this._pendingTags.get(tag);
            if (!info) {
                let resolve = null;
                const promise = new Promise((r) => (resolve = r));
                info = { pendingCount: 0, promise, resolve };
                this._pendingTags.set(tag, info);
            }
            info.pendingCount++;
        }
        _RemovePendingTag(tag) {
            const info = this._pendingTags.get(tag);
            if (!info) throw new Error("expected pending tag");
            info.pendingCount--;
            if (info.pendingCount === 0) {
                info.resolve();
                this._pendingTags.delete(tag);
            }
        }
        TagReady(tag) {
            if (!tag) tag = this._lastPlayedTag;
            const info = this._pendingTags.get(tag);
            if (info) return info.promise;
            else return Promise.resolve();
        }
        _MaybeStartTicking() {
            if (this._analysers.size > 0) {
                this._StartTicking();
                return;
            }
            for (const ai of this._audioInstances)
                if (ai.IsActive()) {
                    this._StartTicking();
                    return;
                }
        }
        Tick() {
            for (const a of this._analysers) a.Tick();
            const currentTime = this.GetAudioCurrentTime();
            for (const ai of this._audioInstances) ai.Tick(currentTime);
            const instStates = this._audioInstances
                .filter((a) => a.IsActive())
                .map((a) => a.GetState());
            this.PostToRuntime("state", {
                tickCount: this._lastTickCount,
                audioInstances: instStates,
                analysers: [...this._analysers].map((a) => a.GetData()),
            });
            if (instStates.length === 0 && this._analysers.size === 0)
                this._StopTicking();
        }
        PostTrigger(type, tag, aiid) {
            this.PostToRuntime("trigger", { type: type, tag: tag, aiid: aiid });
        }
        async _Play(e) {
            const originalUrl = e["originalUrl"];
            const url = e["url"];
            const type = e["type"];
            const isMusic = e["isMusic"];
            const tag = e["tag"];
            const isLooping = e["isLooping"];
            const volume = e["vol"];
            const position = e["pos"];
            const panning = e["panning"];
            let startTime = e["off"];
            if (startTime > 0 && !e["trueClock"])
                if (this._audioContext["getOutputTimestamp"]) {
                    const outputTimestamp = this._audioContext["getOutputTimestamp"]();
                    startTime =
                        startTime -
                        outputTimestamp["performanceTime"] / 1e3 +
                        outputTimestamp["contextTime"];
                } else
                    startTime =
                        startTime -
                        performance.now() / 1e3 +
                        this._audioContext["currentTime"];
            this._lastPlayedTag = tag;
            this._AddPendingTag(tag);
            try {
                this._lastAudioInstance = await this._GetAudioInstance(
                    originalUrl,
                    url,
                    type,
                    tag,
                    isMusic
                );
                if (panning) {
                    this._lastAudioInstance.SetPannerEnabled(true);
                    this._lastAudioInstance.SetPan(
                        panning["x"],
                        panning["y"],
                        panning["angle"],
                        panning["innerAngle"],
                        panning["outerAngle"],
                        panning["outerGain"]
                    );
                    if (panning.hasOwnProperty("uid"))
                        this._lastAudioInstance.SetUID(panning["uid"]);
                } else this._lastAudioInstance.SetPannerEnabled(false);
                this._lastAudioInstance.Play(isLooping, volume, position, startTime);
            } catch (err) {
                console.error("[Construct 3] Audio: error starting playback: ", err);
                return;
            } finally {
                this._RemovePendingTag(tag);
            }
            this._StartTicking();
        }
        _Stop(e) {
            const tag = e["tag"];
            for (const ai of this.audioInstancesByTag(tag)) ai.Stop();
        }
        _StopAll() {
            for (const ai of this._audioInstances) ai.Stop();
        }
        _SetPaused(e) {
            const tag = e["tag"];
            const paused = e["paused"];
            for (const ai of this.audioInstancesByTag(tag))
                if (paused) ai.Pause();
                else ai.Resume();
            this._MaybeStartTicking();
        }
        _SetVolume(e) {
            const tag = e["tag"];
            const vol = e["vol"];
            for (const ai of this.audioInstancesByTag(tag)) ai.SetVolume(vol);
        }
        async _FadeVolume(e) {
            const tag = e["tag"];
            const vol = e["vol"];
            const duration = e["duration"];
            const stopOnEnd = e["stopOnEnd"];
            await this.TagReady(tag);
            for (const ai of this.audioInstancesByTag(tag))
                ai.FadeVolume(vol, duration, stopOnEnd);
            this._MaybeStartTicking();
        }
        _SetMasterVolume(e) {
            this._masterVolume = e["vol"];
            for (const ai of this._audioInstances) ai._UpdateVolume();
        }
        _SetMuted(e) {
            const tag = e["tag"];
            const isMuted = e["isMuted"];
            for (const ai of this.audioInstancesByTag(tag)) ai.SetMuted(isMuted);
        }
        _SetSilent(e) {
            this._isSilent = e["isSilent"];
            this._iRuntime.SetSilent(this._isSilent);
            for (const ai of this._audioInstances) ai._UpdateMuted();
        }
        _SetLooping(e) {
            const tag = e["tag"];
            const isLooping = e["isLooping"];
            for (const ai of this.audioInstancesByTag(tag)) ai.SetLooping(isLooping);
        }
        async _SetPlaybackRate(e) {
            const tag = e["tag"];
            const rate = e["rate"];
            await this.TagReady(tag);
            for (const ai of this.audioInstancesByTag(tag)) ai.SetPlaybackRate(rate);
        }
        async _Seek(e) {
            const tag = e["tag"];
            const pos = e["pos"];
            await this.TagReady(tag);
            for (const ai of this.audioInstancesByTag(tag)) ai.Seek(pos);
        }
        async _Preload(e) {
            const originalUrl = e["originalUrl"];
            const url = e["url"];
            const type = e["type"];
            const isMusic = e["isMusic"];
            try {
                await this._GetAudioInstance(originalUrl, url, type, "", isMusic);
            } catch (err) {
                console.error("[Construct 3] Audio: error preloading: ", err);
            }
        }
        async _Unload(e) {
            const url = e["url"];
            const type = e["type"];
            const isMusic = e["isMusic"];
            const buffer = await this._GetAudioBuffer("", url, type, isMusic, true);
            if (!buffer) return;
            buffer.Release();
            const i = this._audioBuffers.indexOf(buffer);
            if (i !== -1) this._audioBuffers.splice(i, 1);
        }
        _UnloadAll() {
            for (const buffer of this._audioBuffers) buffer.Release();
            this._audioBuffers.length = 0;
        }
        _SetSuspended(e) {
            const isSuspended = e["isSuspended"];
            if (!isSuspended && this._audioContext["resume"])
                this._audioContext["resume"]();
            for (const ai of this._audioInstances) ai.SetSuspended(isSuspended);
            if (isSuspended && this._audioContext["suspend"])
                this._audioContext["suspend"]();
        }
        _OnTick(e) {
            this._timeScale = e["timeScale"];
            this._gameTime = e["gameTime"];
            this._lastTickCount = e["tickCount"];
            if (this._timeScaleMode !== 0)
                for (const ai of this._audioInstances) ai._UpdatePlaybackRate();
            const listenerPos = e["listenerPos"];
            if (listenerPos)
                this._audioContext["listener"]["setPosition"](
                    listenerPos[0],
                    listenerPos[1],
                    listenerPos[2]
                );
            for (const instPan of e["instPans"]) {
                const uid = instPan["uid"];
                for (const ai of this._audioInstances)
                    if (ai.GetUID() === uid)
                        ai.SetPanXYA(instPan["x"], instPan["y"], instPan["angle"]);
            }
        }
        async _AddEffect(e) {
            const type = e["type"];
            const tag = e["tag"];
            const params = e["params"];
            let effect;
            if (type === "filter") effect = new self.C3AudioFilterFX(this, ...params);
            else if (type === "delay")
                effect = new self.C3AudioDelayFX(this, ...params);
            else if (type === "convolution") {
                let buffer = null;
                try {
                    buffer = await this._GetAudioBuffer(
                        e["bufferOriginalUrl"],
                        e["bufferUrl"],
                        e["bufferType"],
                        false
                    );
                } catch (err) {
                    console.log("[Construct 3] Audio: error loading convolution: ", err);
                    return;
                }
                effect = new self.C3AudioConvolveFX(
                    this,
                    buffer.GetAudioBuffer(),
                    ...params
                );
                effect._SetBufferInfo(
                    e["bufferOriginalUrl"],
                    e["bufferUrl"],
                    e["bufferType"]
                );
            } else if (type === "flanger")
                effect = new self.C3AudioFlangerFX(this, ...params);
            else if (type === "phaser")
                effect = new self.C3AudioPhaserFX(this, ...params);
            else if (type === "gain")
                effect = new self.C3AudioGainFX(this, ...params);
            else if (type === "tremolo")
                effect = new self.C3AudioTremoloFX(this, ...params);
            else if (type === "ringmod")
                effect = new self.C3AudioRingModFX(this, ...params);
            else if (type === "distortion")
                effect = new self.C3AudioDistortionFX(this, ...params);
            else if (type === "compressor")
                effect = new self.C3AudioCompressorFX(this, ...params);
            else if (type === "analyser")
                effect = new self.C3AudioAnalyserFX(this, ...params);
            else throw new Error("invalid effect type");
            this.AddEffectForTag(tag, effect);
            this._PostUpdatedFxState();
        }
        _SetEffectParam(e) {
            const tag = e["tag"];
            const index = e["index"];
            const param = e["param"];
            const value = e["value"];
            const ramp = e["ramp"];
            const time = e["time"];
            const fxChain = this._effects.get(tag);
            if (!fxChain || index < 0 || index >= fxChain.length) return;
            fxChain[index].SetParam(param, value, ramp, time);
            this._PostUpdatedFxState();
        }
        _RemoveEffects(e) {
            const tag = e["tag"].toLowerCase();
            const fxChain = this._effects.get(tag);
            if (!fxChain || !fxChain.length) return;
            for (const effect of fxChain) effect.Release();
            this._effects.delete(tag);
            this._ReconnectEffects(tag);
        }
        _AddAnalyser(analyser) {
            this._analysers.add(analyser);
            this._MaybeStartTicking();
        }
        _RemoveAnalyser(analyser) {
            this._analysers.delete(analyser);
        }
        _PostUpdatedFxState() {
            if (this._isPendingPostFxState) return;
            this._isPendingPostFxState = true;
            Promise.resolve().then(() => this._DoPostUpdatedFxState());
        }
        _DoPostUpdatedFxState() {
            const fxstate = {};
            for (const [tag, fxChain] of this._effects)
                fxstate[tag] = fxChain.map((e) => e.GetState());
            this.PostToRuntime("fxstate", { fxstate: fxstate });
            this._isPendingPostFxState = false;
        }
        async _OnLoadState(e) {
            const saveLoadMode = e["saveLoadMode"];
            if (saveLoadMode !== 3)
                for (const ai of this._audioInstances) {
                    if (ai.IsMusic() && saveLoadMode === 1) continue;
                    if (!ai.IsMusic() && saveLoadMode === 2) continue;
                    ai.Stop();
                }
            for (const fxChain of this._effects.values())
                for (const effect of fxChain) effect.Release();
            this._effects.clear();
            this._timeScale = e["timeScale"];
            this._gameTime = e["gameTime"];
            const listenerPos = e["listenerPos"];
            this._audioContext["listener"]["setPosition"](
                listenerPos[0],
                listenerPos[1],
                listenerPos[2]
            );
            this._isSilent = e["isSilent"];
            this._iRuntime.SetSilent(this._isSilent);
            this._masterVolume = e["masterVolume"];
            const promises = [];
            for (const fxChainData of Object.values(e["effects"]))
                promises.push(Promise.all(fxChainData.map((d) => this._AddEffect(d))));
            await Promise.all(promises);
            await Promise.all(
                e["playing"].map((d) => this._LoadAudioInstance(d, saveLoadMode))
            );
            this._MaybeStartTicking();
        }
        async _LoadAudioInstance(d, saveLoadMode) {
            if (saveLoadMode === 3) return;
            const originalUrl = d["bufferOriginalUrl"];
            const url = d["bufferUrl"];
            const type = d["bufferType"];
            const isMusic = d["isMusic"];
            const tag = d["tag"];
            const isLooping = d["isLooping"];
            const volume = d["volume"];
            const position = d["playbackTime"];
            if (isMusic && saveLoadMode === 1) return;
            if (!isMusic && saveLoadMode === 2) return;
            let ai = null;
            try {
                ai = await this._GetAudioInstance(originalUrl, url, type, tag, isMusic);
            } catch (err) {
                console.error("[Construct 3] Audio: error loading audio state: ", err);
                return;
            }
            ai.LoadPanState(d["pan"]);
            ai.Play(isLooping, volume, position, 0);
            if (!d["isPlaying"]) ai.Pause();
            ai._LoadAdditionalState(d);
        }
        _OnMicrophoneStream(localMediaStream, tag) {
            if (this._microphoneSource) this._microphoneSource["disconnect"]();
            this._microphoneTag = tag.toLowerCase();
            this._microphoneSource = this._audioContext["createMediaStreamSource"](
                localMediaStream
            );
            this._microphoneSource["connect"](
                this.GetDestinationForTag(this._microphoneTag)
            );
        }
        _OnGetOutputStream() {
            if (!this._destMediaStreamNode) {
                this._destMediaStreamNode = this._audioContext[
                    "createMediaStreamDestination"
                    ]();
                this._destinationNode["connect"](this._destMediaStreamNode);
            }
            return this._destMediaStreamNode["stream"];
        }
        static EqualsNoCase(a, b) {
            if (a.length !== b.length) return false;
            if (a === b) return true;
            return a.toLowerCase() === b.toLowerCase();
        }
        static ToDegrees(x) {
            return x * R_TO_D;
        }
        static DbToLinearNoCap(x) {
            return Math.pow(10, x / 20);
        }
        static DbToLinear(x) {
            return Math.max(Math.min(self.AudioDOMHandler.DbToLinearNoCap(x), 1), 0);
        }
        static LinearToDbNoCap(x) {
            return (Math.log(x) / Math.log(10)) * 20;
        }
        static LinearToDb(x) {
            return self.AudioDOMHandler.LinearToDbNoCap(Math.max(Math.min(x, 1), 0));
        }
        static e4(x, k) {
            return 1 - Math.exp(-k * x);
        }
    };
    self.RuntimeInterface.AddDOMHandlerClass(self.AudioDOMHandler);
}
("use strict");
{
    self.C3AudioBuffer = class C3AudioBuffer {
        constructor(audioDomHandler, originalUrl, url, type, isMusic) {
            this._audioDomHandler = audioDomHandler;
            this._originalUrl = originalUrl;
            this._url = url;
            this._type = type;
            this._isMusic = isMusic;
            this._api = "";
            this._loadState = "not-loaded";
            this._loadPromise = null;
        }
        Release() {
            this._loadState = "not-loaded";
            this._audioDomHandler = null;
            this._loadPromise = null;
        }
        static Create(audioDomHandler, originalUrl, url, type, isMusic) {
            const needsSoftwareDecode =
                type === "audio/webm; codecs=opus" &&
                !audioDomHandler.SupportsWebMOpus();
            if (isMusic && needsSoftwareDecode)
                audioDomHandler._SetHasAnySoftwareDecodedMusic();
            if (
                !isMusic ||
                audioDomHandler.IsPlayMusicAsSound() ||
                needsSoftwareDecode
            )
                return new self.C3WebAudioBuffer(
                    audioDomHandler,
                    originalUrl,
                    url,
                    type,
                    isMusic,
                    needsSoftwareDecode
                );
            else
                return new self.C3Html5AudioBuffer(
                    audioDomHandler,
                    originalUrl,
                    url,
                    type,
                    isMusic
                );
        }
        CreateInstance(tag) {
            if (this._api === "html5")
                return new self.C3Html5AudioInstance(this._audioDomHandler, this, tag);
            else return new self.C3WebAudioInstance(this._audioDomHandler, this, tag);
        }
        _Load() {}
        Load() {
            if (!this._loadPromise) this._loadPromise = this._Load();
            return this._loadPromise;
        }
        IsLoaded() {}
        IsLoadedAndDecoded() {}
        HasFailedToLoad() {
            return this._loadState === "failed";
        }
        GetAudioContext() {
            return this._audioDomHandler.GetAudioContext();
        }
        GetApi() {
            return this._api;
        }
        GetOriginalUrl() {
            return this._originalUrl;
        }
        GetUrl() {
            return this._url;
        }
        GetContentType() {
            return this._type;
        }
        IsMusic() {
            return this._isMusic;
        }
        GetDuration() {}
    };
}
("use strict");
{
    self.C3Html5AudioBuffer = class C3Html5AudioBuffer extends (
        self.C3AudioBuffer
    ) {
        constructor(audioDomHandler, originalUrl, url, type, isMusic) {
            super(audioDomHandler, originalUrl, url, type, isMusic);
            this._api = "html5";
            this._audioElem = new Audio();
            this._audioElem.crossOrigin = "anonymous";
            this._audioElem.autoplay = false;
            this._audioElem.preload = "auto";
            this._loadResolve = null;
            this._loadReject = null;
            this._reachedCanPlayThrough = false;
            this._audioElem.addEventListener(
                "canplaythrough",
                () => (this._reachedCanPlayThrough = true)
            );
            this._outNode = this.GetAudioContext()["createGain"]();
            this._mediaSourceNode = null;
            this._audioElem.addEventListener("canplay", () => {
                if (this._loadResolve) {
                    this._loadState = "loaded";
                    this._loadResolve();
                    this._loadResolve = null;
                    this._loadReject = null;
                }
                if (this._mediaSourceNode || !this._audioElem) return;
                this._mediaSourceNode = this.GetAudioContext()[
                    "createMediaElementSource"
                    ](this._audioElem);
                this._mediaSourceNode["connect"](this._outNode);
            });
            this.onended = null;
            this._audioElem.addEventListener("ended", () => {
                if (this.onended) this.onended();
            });
            this._audioElem.addEventListener("error", (e) => this._OnError(e));
        }
        Release() {
            this._audioDomHandler.ReleaseInstancesForBuffer(this);
            this._outNode["disconnect"]();
            this._outNode = null;
            this._mediaSourceNode["disconnect"]();
            this._mediaSourceNode = null;
            if (this._audioElem && !this._audioElem.paused) this._audioElem.pause();
            this.onended = null;
            this._audioElem = null;
            super.Release();
        }
        _Load() {
            this._loadState = "loading";
            return new Promise((resolve, reject) => {
                this._loadResolve = resolve;
                this._loadReject = reject;
                this._audioElem.src = this._url;
            });
        }
        _OnError(e) {
            console.error(`[Construct 3] Audio '${this._url}' error: `, e);
            if (this._loadReject) {
                this._loadState = "failed";
                this._loadReject(e);
                this._loadResolve = null;
                this._loadReject = null;
            }
        }
        IsLoaded() {
            const ret = this._audioElem["readyState"] >= 4;
            if (ret) this._reachedCanPlayThrough = true;
            return ret || this._reachedCanPlayThrough;
        }
        IsLoadedAndDecoded() {
            return this.IsLoaded();
        }
        GetAudioElement() {
            return this._audioElem;
        }
        GetOutputNode() {
            return this._outNode;
        }
        GetDuration() {
            return this._audioElem["duration"];
        }
    };
}
("use strict");
{
    self.C3WebAudioBuffer = class C3WebAudioBuffer extends self.C3AudioBuffer {
        constructor(
            audioDomHandler,
            originalUrl,
            url,
            type,
            isMusic,
            needsSoftwareDecode
        ) {
            super(audioDomHandler, originalUrl, url, type, isMusic);
            this._api = "webaudio";
            this._audioData = null;
            this._audioBuffer = null;
            this._needsSoftwareDecode = !!needsSoftwareDecode;
        }
        Release() {
            this._audioDomHandler.ReleaseInstancesForBuffer(this);
            this._audioData = null;
            this._audioBuffer = null;
            super.Release();
        }
        async _Fetch() {
            if (this._audioData) return this._audioData;
            const iRuntime = this._audioDomHandler.GetRuntimeInterface();
            if (
                iRuntime.GetExportType() === "cordova" &&
                iRuntime.IsRelativeURL(this._url) &&
                location.protocol === "file:"
            )
                this._audioData = await iRuntime.CordovaFetchLocalFileAsArrayBuffer(
                    this._url
                );
            else {
                const response = await fetch(this._url);
                if (!response.ok)
                    throw new Error(
                        `error fetching audio data: ${response.status} ${response.statusText}`
                    );
                this._audioData = await response.arrayBuffer();
            }
        }
        async _Decode() {
            if (this._audioBuffer) return this._audioBuffer;
            this._audioBuffer = await this._audioDomHandler.DecodeAudioData(
                this._audioData,
                this._needsSoftwareDecode
            );
            this._audioData = null;
        }
        async _Load() {
            try {
                this._loadState = "loading";
                await this._Fetch();
                await this._Decode();
                this._loadState = "loaded";
            } catch (err) {
                this._loadState = "failed";
                console.error(
                    `[Construct 3] Failed to load audio '${this._url}': `,
                    err
                );
            }
        }
        IsLoaded() {
            return !!(this._audioData || this._audioBuffer);
        }
        IsLoadedAndDecoded() {
            return !!this._audioBuffer;
        }
        GetAudioBuffer() {
            return this._audioBuffer;
        }
        GetDuration() {
            return this._audioBuffer ? this._audioBuffer["duration"] : 0;
        }
    };
}
("use strict");
{
    let nextAiId = 0;
    self.C3AudioInstance = class C3AudioInstance {
        constructor(audioDomHandler, buffer, tag) {
            this._audioDomHandler = audioDomHandler;
            this._buffer = buffer;
            this._tag = tag;
            this._aiId = nextAiId++;
            this._gainNode = this.GetAudioContext()["createGain"]();
            this._gainNode["connect"](this.GetDestinationNode());
            this._pannerNode = null;
            this._isPannerEnabled = false;
            this._pannerPosition = [0, 0, 0];
            this._pannerOrientation = [0, 0, 0];
            this._isStopped = true;
            this._isPaused = false;
            this._resumeMe = false;
            this._isLooping = false;
            this._volume = 1;
            this._isMuted = false;
            this._playbackRate = 1;
            const timeScaleMode = this._audioDomHandler.GetTimeScaleMode();
            this._isTimescaled =
                (timeScaleMode === 1 && !this.IsMusic()) || timeScaleMode === 2;
            this._instUid = -1;
            this._fadeEndTime = -1;
            this._stopOnFadeEnd = false;
        }
        Release() {
            this._audioDomHandler = null;
            this._buffer = null;
            if (this._pannerNode) {
                this._pannerNode["disconnect"]();
                this._pannerNode = null;
            }
            this._gainNode["disconnect"]();
            this._gainNode = null;
        }
        GetAudioContext() {
            return this._audioDomHandler.GetAudioContext();
        }
        GetDestinationNode() {
            return this._audioDomHandler.GetDestinationForTag(this._tag);
        }
        GetMasterVolume() {
            return this._audioDomHandler.GetMasterVolume();
        }
        GetCurrentTime() {
            if (this._isTimescaled) return this._audioDomHandler.GetGameTime();
            else return performance.now() / 1e3;
        }
        GetOriginalUrl() {
            return this._buffer.GetOriginalUrl();
        }
        GetUrl() {
            return this._buffer.GetUrl();
        }
        GetContentType() {
            return this._buffer.GetContentType();
        }
        GetBuffer() {
            return this._buffer;
        }
        IsMusic() {
            return this._buffer.IsMusic();
        }
        SetTag(tag) {
            this._tag = tag;
        }
        GetTag() {
            return this._tag;
        }
        GetAiId() {
            return this._aiId;
        }
        HasEnded() {}
        CanBeRecycled() {}
        IsPlaying() {
            return !this._isStopped && !this._isPaused && !this.HasEnded();
        }
        IsActive() {
            return !this._isStopped && !this.HasEnded();
        }
        GetPlaybackTime(applyPlaybackRate) {}
        GetDuration(applyPlaybackRate) {
            let ret = this._buffer.GetDuration();
            if (applyPlaybackRate) ret /= this._playbackRate || 0.001;
            return ret;
        }
        Play(isLooping, vol, seekPos, scheduledTime) {}
        Stop() {}
        Pause() {}
        IsPaused() {
            return this._isPaused;
        }
        Resume() {}
        SetVolume(v) {
            this._volume = v;
            this._gainNode["gain"]["cancelScheduledValues"](0);
            this._fadeEndTime = -1;
            this._gainNode["gain"]["value"] = this.GetOverallVolume();
        }
        FadeVolume(vol, duration, stopOnEnd) {
            if (this.IsMuted()) return;
            vol *= this.GetMasterVolume();
            const gainParam = this._gainNode["gain"];
            gainParam["cancelScheduledValues"](0);
            const currentTime = this._audioDomHandler.GetAudioCurrentTime();
            const endTime = currentTime + duration;
            gainParam["setValueAtTime"](gainParam["value"], currentTime);
            gainParam["linearRampToValueAtTime"](vol, endTime);
            this._volume = vol;
            this._fadeEndTime = endTime;
            this._stopOnFadeEnd = stopOnEnd;
        }
        _UpdateVolume() {
            this.SetVolume(this._volume);
        }
        Tick(currentTime) {
            if (this._fadeEndTime !== -1 && currentTime >= this._fadeEndTime) {
                this._fadeEndTime = -1;
                if (this._stopOnFadeEnd) this.Stop();
                this._audioDomHandler.PostTrigger("fade-ended", this._tag, this._aiId);
            }
        }
        GetOverallVolume() {
            const ret = this._volume * this.GetMasterVolume();
            return isFinite(ret) ? ret : 0;
        }
        SetMuted(m) {
            m = !!m;
            if (this._isMuted === m) return;
            this._isMuted = m;
            this._UpdateMuted();
        }
        IsMuted() {
            return this._isMuted;
        }
        IsSilent() {
            return this._audioDomHandler.IsSilent();
        }
        _UpdateMuted() {}
        SetLooping(l) {}
        IsLooping() {
            return this._isLooping;
        }
        SetPlaybackRate(r) {
            if (this._playbackRate === r) return;
            this._playbackRate = r;
            this._UpdatePlaybackRate();
        }
        _UpdatePlaybackRate() {}
        GetPlaybackRate() {
            return this._playbackRate;
        }
        Seek(pos) {}
        SetSuspended(s) {}
        SetPannerEnabled(e) {
            e = !!e;
            if (this._isPannerEnabled === e) return;
            this._isPannerEnabled = e;
            if (this._isPannerEnabled) {
                if (!this._pannerNode) {
                    this._pannerNode = this.GetAudioContext()["createPanner"]();
                    this._pannerNode[
                        "panningModel"
                        ] = this._audioDomHandler.GetPanningModel();
                    this._pannerNode[
                        "distanceModel"
                        ] = this._audioDomHandler.GetDistanceModel();
                    this._pannerNode[
                        "refDistance"
                        ] = this._audioDomHandler.GetReferenceDistance();
                    this._pannerNode[
                        "maxDistance"
                        ] = this._audioDomHandler.GetMaxDistance();
                    this._pannerNode[
                        "rolloffFactor"
                        ] = this._audioDomHandler.GetRolloffFactor();
                }
                this._gainNode["disconnect"]();
                this._gainNode["connect"](this._pannerNode);
                this._pannerNode["connect"](this.GetDestinationNode());
            } else {
                this._pannerNode["disconnect"]();
                this._gainNode["disconnect"]();
                this._gainNode["connect"](this.GetDestinationNode());
            }
        }
        SetPan(x, y, angle, innerAngle, outerAngle, outerGain) {
            if (!this._isPannerEnabled) return;
            this.SetPanXYA(x, y, angle);
            const toDegrees = self.AudioDOMHandler.ToDegrees;
            this._pannerNode["coneInnerAngle"] = toDegrees(innerAngle);
            this._pannerNode["coneOuterAngle"] = toDegrees(outerAngle);
            this._pannerNode["coneOuterGain"] = outerGain;
        }
        SetPanXYA(x, y, angle) {
            if (!this._isPannerEnabled) return;
            this._pannerPosition[0] = x;
            this._pannerPosition[1] = y;
            this._pannerPosition[2] = 0;
            this._pannerOrientation[0] = Math.cos(angle);
            this._pannerOrientation[1] = Math.sin(angle);
            this._pannerOrientation[2] = 0;
            this._pannerNode["setPosition"](...this._pannerPosition);
            this._pannerNode["setOrientation"](...this._pannerOrientation);
        }
        SetUID(uid) {
            this._instUid = uid;
        }
        GetUID() {
            return this._instUid;
        }
        GetResumePosition() {}
        Reconnect(toNode) {
            const outNode = this._pannerNode || this._gainNode;
            outNode["disconnect"]();
            outNode["connect"](toNode);
        }
        GetState() {
            return {
                aiid: this.GetAiId(),
                tag: this._tag,
                duration: this.GetDuration(),
                volume: this._volume,
                isPlaying: this.IsPlaying(),
                playbackTime: this.GetPlaybackTime(),
                playbackRate: this.GetPlaybackRate(),
                uid: this._instUid,
                bufferOriginalUrl: this.GetOriginalUrl(),
                bufferUrl: "",
                bufferType: this.GetContentType(),
                isMusic: this.IsMusic(),
                isLooping: this.IsLooping(),
                isMuted: this.IsMuted(),
                resumePosition: this.GetResumePosition(),
                pan: this.GetPanState(),
            };
        }
        _LoadAdditionalState(d) {
            this.SetPlaybackRate(d["playbackRate"]);
            this.SetMuted(d["isMuted"]);
        }
        GetPanState() {
            if (!this._pannerNode) return null;
            const pn = this._pannerNode;
            return {
                pos: this._pannerPosition,
                orient: this._pannerOrientation,
                cia: pn["coneInnerAngle"],
                coa: pn["coneOuterAngle"],
                cog: pn["coneOuterGain"],
                uid: this._instUid,
            };
        }
        LoadPanState(d) {
            if (!d) {
                this.SetPannerEnabled(false);
                return;
            }
            this.SetPannerEnabled(true);
            const pn = this._pannerNode;
            const panPos = pn["pos"];
            this._pannerPosition[0] = panPos[0];
            this._pannerPosition[1] = panPos[1];
            this._pannerPosition[2] = panPos[2];
            const panOrient = pn["orient"];
            this._pannerOrientation[0] = panOrient[0];
            this._pannerOrientation[1] = panOrient[1];
            this._pannerOrientation[2] = panOrient[2];
            pn["setPosition"](...this._pannerPosition);
            pn["setOrientation"](...this._pannerOrientation);
            pn["coneInnerAngle"] = pn["cia"];
            pn["coneOuterAngle"] = pn["coa"];
            pn["coneOuterGain"] = pn["cog"];
            this._instUid = pn["uid"];
        }
    };
}
("use strict");
{
    self.C3Html5AudioInstance = class C3Html5AudioInstance extends (
        self.C3AudioInstance
    ) {
        constructor(audioDomHandler, buffer, tag) {
            super(audioDomHandler, buffer, tag);
            this._buffer.GetOutputNode()["connect"](this._gainNode);
            this._buffer.onended = () => this._OnEnded();
        }
        Release() {
            this.Stop();
            this._buffer.GetOutputNode()["disconnect"]();
            super.Release();
        }
        GetAudioElement() {
            return this._buffer.GetAudioElement();
        }
        _OnEnded() {
            this._isStopped = true;
            this._instUid = -1;
            this._audioDomHandler.PostTrigger("ended", this._tag, this._aiId);
        }
        HasEnded() {
            return this.GetAudioElement()["ended"];
        }
        CanBeRecycled() {
            if (this._isStopped) return true;
            return this.HasEnded();
        }
        GetPlaybackTime(applyPlaybackRate) {
            let ret = this.GetAudioElement()["currentTime"];
            if (applyPlaybackRate) ret *= this._playbackRate;
            if (!this._isLooping) ret = Math.min(ret, this.GetDuration());
            return ret;
        }
        Play(isLooping, vol, seekPos, scheduledTime) {
            const audioElem = this.GetAudioElement();
            if (audioElem.playbackRate !== 1) audioElem.playbackRate = 1;
            if (audioElem.loop !== isLooping) audioElem.loop = isLooping;
            this.SetVolume(vol);
            if (audioElem.muted) audioElem.muted = false;
            if (audioElem.currentTime !== seekPos)
                try {
                    audioElem.currentTime = seekPos;
                } catch (err) {
                    console.warn(
                        `[Construct 3] Exception seeking audio '${this._buffer.GetUrl()}' to position '${seekPos}': `,
                        err
                    );
                }
            this._audioDomHandler.TryPlayMedia(audioElem);
            this._isStopped = false;
            this._isPaused = false;
            this._isLooping = isLooping;
            this._playbackRate = 1;
        }
        Stop() {
            const audioElem = this.GetAudioElement();
            if (!audioElem.paused) audioElem.pause();
            this._audioDomHandler.RemovePendingPlay(audioElem);
            this._isStopped = true;
            this._isPaused = false;
            this._instUid = -1;
        }
        Pause() {
            if (this._isPaused || this._isStopped || this.HasEnded()) return;
            const audioElem = this.GetAudioElement();
            if (!audioElem.paused) audioElem.pause();
            this._audioDomHandler.RemovePendingPlay(audioElem);
            this._isPaused = true;
        }
        Resume() {
            if (!this._isPaused || this._isStopped || this.HasEnded()) return;
            this._audioDomHandler.TryPlayMedia(this.GetAudioElement());
            this._isPaused = false;
        }
        _UpdateMuted() {
            this.GetAudioElement().muted = this._isMuted || this.IsSilent();
        }
        SetLooping(l) {
            l = !!l;
            if (this._isLooping === l) return;
            this._isLooping = l;
            this.GetAudioElement().loop = l;
        }
        _UpdatePlaybackRate() {
            let r = this._playbackRate;
            if (this._isTimescaled) r *= this._audioDomHandler.GetTimeScale();
            try {
                this.GetAudioElement()["playbackRate"] = r;
            } catch (err) {
                console.warn(`[Construct 3] Unable to set playback rate '${r}':`, err);
            }
        }
        Seek(pos) {
            if (this._isStopped || this.HasEnded()) return;
            try {
                this.GetAudioElement()["currentTime"] = pos;
            } catch (err) {
                console.warn(`[Construct 3] Error seeking audio to '${pos}': `, err);
            }
        }
        GetResumePosition() {
            return this.GetPlaybackTime();
        }
        SetSuspended(s) {
            if (s)
                if (this.IsPlaying()) {
                    this.GetAudioElement()["pause"]();
                    this._resumeMe = true;
                } else this._resumeMe = false;
            else if (this._resumeMe) {
                this._audioDomHandler.TryPlayMedia(this.GetAudioElement());
                this._resumeMe = false;
            }
        }
    };
}
("use strict");
{
    self.C3WebAudioInstance = class C3WebAudioInstance extends (
        self.C3AudioInstance
    ) {
        constructor(audioDomHandler, buffer, tag) {
            super(audioDomHandler, buffer, tag);
            this._bufferSource = null;
            this._onended_handler = (e) => this._OnEnded(e);
            this._hasPlaybackEnded = true;
            this._activeSource = null;
            this._startTime = 0;
            this._resumePosition = 0;
            this._muteVol = 1;
        }
        Release() {
            this.Stop();
            this._ReleaseBufferSource();
            this._onended_handler = null;
            super.Release();
        }
        _ReleaseBufferSource() {
            if (this._bufferSource) this._bufferSource["disconnect"]();
            this._bufferSource = null;
            this._activeSource = null;
        }
        _OnEnded(e) {
            if (this._isPaused || this._resumeMe) return;
            if (e.target !== this._activeSource) return;
            this._hasPlaybackEnded = true;
            this._isStopped = true;
            this._instUid = -1;
            this._ReleaseBufferSource();
            this._audioDomHandler.PostTrigger("ended", this._tag, this._aiId);
        }
        HasEnded() {
            if (!this._isStopped && this._bufferSource && this._bufferSource["loop"])
                return false;
            if (this._isPaused) return false;
            return this._hasPlaybackEnded;
        }
        CanBeRecycled() {
            if (!this._bufferSource || this._isStopped) return true;
            return this.HasEnded();
        }
        GetPlaybackTime(applyPlaybackRate) {
            let ret = 0;
            if (this._isPaused) ret = this._resumePosition;
            else ret = this.GetCurrentTime() - this._startTime;
            if (applyPlaybackRate) ret *= this._playbackRate;
            if (!this._isLooping) ret = Math.min(ret, this.GetDuration());
            return ret;
        }
        Play(isLooping, vol, seekPos, scheduledTime) {
            this._muteVol = 1;
            this.SetVolume(vol);
            this._ReleaseBufferSource();
            this._bufferSource = this.GetAudioContext()["createBufferSource"]();
            this._bufferSource["buffer"] = this._buffer.GetAudioBuffer();
            this._bufferSource["connect"](this._gainNode);
            this._activeSource = this._bufferSource;
            this._bufferSource["onended"] = this._onended_handler;
            this._bufferSource["loop"] = isLooping;
            this._bufferSource["start"](scheduledTime, seekPos);
            this._hasPlaybackEnded = false;
            this._isStopped = false;
            this._isPaused = false;
            this._isLooping = isLooping;
            this._playbackRate = 1;
            this._startTime = this.GetCurrentTime() - seekPos;
        }
        Stop() {
            if (this._bufferSource)
                try {
                    this._bufferSource["stop"](0);
                } catch (err) {}
            this._isStopped = true;
            this._isPaused = false;
            this._instUid = -1;
        }
        Pause() {
            if (this._isPaused || this._isStopped || this.HasEnded()) return;
            this._resumePosition = this.GetPlaybackTime(true);
            if (this._isLooping) this._resumePosition %= this.GetDuration();
            this._isPaused = true;
            this._bufferSource["stop"](0);
        }
        Resume() {
            if (!this._isPaused || this._isStopped || this.HasEnded()) return;
            this._ReleaseBufferSource();
            this._bufferSource = this.GetAudioContext()["createBufferSource"]();
            this._bufferSource["buffer"] = this._buffer.GetAudioBuffer();
            this._bufferSource["connect"](this._gainNode);
            this._activeSource = this._bufferSource;
            this._bufferSource["onended"] = this._onended_handler;
            this._bufferSource["loop"] = this._isLooping;
            this._UpdateVolume();
            this._UpdatePlaybackRate();
            this._startTime =
                this.GetCurrentTime() -
                this._resumePosition / (this._playbackRate || 0.001);
            this._bufferSource["start"](0, this._resumePosition);
            this._isPaused = false;
        }
        GetOverallVolume() {
            return super.GetOverallVolume() * this._muteVol;
        }
        _UpdateMuted() {
            this._muteVol = this._isMuted || this.IsSilent() ? 0 : 1;
            this._UpdateVolume();
        }
        SetLooping(l) {
            l = !!l;
            if (this._isLooping === l) return;
            this._isLooping = l;
            if (this._bufferSource) this._bufferSource["loop"] = l;
        }
        _UpdatePlaybackRate() {
            let r = this._playbackRate;
            if (this._isTimescaled) r *= this._audioDomHandler.GetTimeScale();
            if (this._bufferSource) this._bufferSource["playbackRate"]["value"] = r;
        }
        Seek(pos) {
            if (this._isStopped || this.HasEnded()) return;
            if (this._isPaused) this._resumePosition = pos;
            else {
                this.Pause();
                this._resumePosition = pos;
                this.Resume();
            }
        }
        GetResumePosition() {
            return this._resumePosition;
        }
        SetSuspended(s) {
            if (s)
                if (this.IsPlaying()) {
                    this._resumeMe = true;
                    this._resumePosition = this.GetPlaybackTime(true);
                    if (this._isLooping) this._resumePosition %= this.GetDuration();
                    this._bufferSource["stop"](0);
                } else this._resumeMe = false;
            else if (this._resumeMe) {
                this._ReleaseBufferSource();
                this._bufferSource = this.GetAudioContext()["createBufferSource"]();
                this._bufferSource["buffer"] = this._buffer.GetAudioBuffer();
                this._bufferSource["connect"](this._gainNode);
                this._activeSource = this._bufferSource;
                this._bufferSource["onended"] = this._onended_handler;
                this._bufferSource["loop"] = this._isLooping;
                this._UpdateVolume();
                this._UpdatePlaybackRate();
                this._startTime =
                    this.GetCurrentTime() -
                    this._resumePosition / (this._playbackRate || 0.001);
                this._bufferSource["start"](0, this._resumePosition);
                this._resumeMe = false;
            }
        }
        _LoadAdditionalState(d) {
            super._LoadAdditionalState(d);
            this._resumePosition = d["resumePosition"];
        }
    };
}
("use strict");
{
    class AudioFXBase {
        constructor(audioDomHandler) {
            this._audioDomHandler = audioDomHandler;
            this._audioContext = audioDomHandler.GetAudioContext();
            this._index = -1;
            this._tag = "";
            this._type = "";
            this._params = null;
        }
        Release() {
            this._audioContext = null;
        }
        _SetIndex(i) {
            this._index = i;
        }
        GetIndex() {
            return this._index;
        }
        _SetTag(t) {
            this._tag = t;
        }
        GetTag() {
            return this._tag;
        }
        CreateGain() {
            return this._audioContext["createGain"]();
        }
        GetInputNode() {}
        ConnectTo(node) {}
        SetAudioParam(ap, value, ramp, time) {
            ap["cancelScheduledValues"](0);
            if (time === 0) {
                ap["value"] = value;
                return;
            }
            const curTime = this._audioContext["currentTime"];
            time += curTime;
            switch (ramp) {
                case 0:
                    ap["setValueAtTime"](value, time);
                    break;
                case 1:
                    ap["setValueAtTime"](ap["value"], curTime);
                    ap["linearRampToValueAtTime"](value, time);
                    break;
                case 2:
                    ap["setValueAtTime"](ap["value"], curTime);
                    ap["exponentialRampToValueAtTime"](value, time);
                    break;
            }
        }
        GetState() {
            return { type: this._type, tag: this._tag, params: this._params };
        }
    }
    self.C3AudioFilterFX = class C3AudioFilterFX extends AudioFXBase {
        constructor(audioDomHandler, type, freq, detune, q, gain, mix) {
            super(audioDomHandler);
            this._type = "filter";
            this._params = [type, freq, detune, q, gain, mix];
            this._inputNode = this.CreateGain();
            this._wetNode = this.CreateGain();
            this._wetNode["gain"]["value"] = mix;
            this._dryNode = this.CreateGain();
            this._dryNode["gain"]["value"] = 1 - mix;
            this._filterNode = this._audioContext["createBiquadFilter"]();
            this._filterNode["type"] = type;
            this._filterNode["frequency"]["value"] = freq;
            this._filterNode["detune"]["value"] = detune;
            this._filterNode["Q"]["value"] = q;
            this._filterNode["gain"]["vlaue"] = gain;
            this._inputNode["connect"](this._filterNode);
            this._inputNode["connect"](this._dryNode);
            this._filterNode["connect"](this._wetNode);
        }
        Release() {
            this._inputNode["disconnect"]();
            this._filterNode["disconnect"]();
            this._wetNode["disconnect"]();
            this._dryNode["disconnect"]();
            super.Release();
        }
        ConnectTo(node) {
            this._wetNode["disconnect"]();
            this._wetNode["connect"](node);
            this._dryNode["disconnect"]();
            this._dryNode["connect"](node);
        }
        GetInputNode() {
            return this._inputNode;
        }
        SetParam(param, value, ramp, time) {
            switch (param) {
                case 0:
                    value = Math.max(Math.min(value / 100, 1), 0);
                    this._params[5] = value;
                    this.SetAudioParam(this._wetNode["gain"], value, ramp, time);
                    this.SetAudioParam(this._dryNode["gain"], 1 - value, ramp, time);
                    break;
                case 1:
                    this._params[1] = value;
                    this.SetAudioParam(this._filterNode["frequency"], value, ramp, time);
                    break;
                case 2:
                    this._params[2] = value;
                    this.SetAudioParam(this._filterNode["detune"], value, ramp, time);
                    break;
                case 3:
                    this._params[3] = value;
                    this.SetAudioParam(this._filterNode["Q"], value, ramp, time);
                    break;
                case 4:
                    this._params[4] = value;
                    this.SetAudioParam(this._filterNode["gain"], value, ramp, time);
                    break;
            }
        }
    };
    self.C3AudioDelayFX = class C3AudioDelayFX extends AudioFXBase {
        constructor(audioDomHandler, delayTime, delayGain, mix) {
            super(audioDomHandler);
            this._type = "delay";
            this._params = [delayTime, delayGain, mix];
            this._inputNode = this.CreateGain();
            this._wetNode = this.CreateGain();
            this._wetNode["gain"]["value"] = mix;
            this._dryNode = this.CreateGain();
            this._dryNode["gain"]["value"] = 1 - mix;
            this._mainNode = this.CreateGain();
            this._delayNode = this._audioContext["createDelay"](delayTime);
            this._delayNode["delayTime"]["value"] = delayTime;
            this._delayGainNode = this.CreateGain();
            this._delayGainNode["gain"]["value"] = delayGain;
            this._inputNode["connect"](this._mainNode);
            this._inputNode["connect"](this._dryNode);
            this._mainNode["connect"](this._wetNode);
            this._mainNode["connect"](this._delayNode);
            this._delayNode["connect"](this._delayGainNode);
            this._delayGainNode["connect"](this._mainNode);
        }
        Release() {
            this._inputNode["disconnect"]();
            this._wetNode["disconnect"]();
            this._dryNode["disconnect"]();
            this._mainNode["disconnect"]();
            this._delayNode["disconnect"]();
            this._delayGainNode["disconnect"]();
            super.Release();
        }
        ConnectTo(node) {
            this._wetNode["disconnect"]();
            this._wetNode["connect"](node);
            this._dryNode["disconnect"]();
            this._dryNode["connect"](node);
        }
        GetInputNode() {
            return this._inputNode;
        }
        SetParam(param, value, ramp, time) {
            const DbToLinear = self.AudioDOMHandler.DbToLinear;
            switch (param) {
                case 0:
                    value = Math.max(Math.min(value / 100, 1), 0);
                    this._params[2] = value;
                    this.SetAudioParam(this._wetNode["gain"], value, ramp, time);
                    this.SetAudioParam(this._dryNode["gain"], 1 - value, ramp, time);
                    break;
                case 4:
                    this._params[1] = DbToLinear(value);
                    this.SetAudioParam(
                        this._delayGainNode["gain"],
                        DbToLinear(value),
                        ramp,
                        time
                    );
                    break;
                case 5:
                    this._params[0] = value;
                    this.SetAudioParam(this._delayNode["delayTime"], value, ramp, time);
                    break;
            }
        }
    };
    self.C3AudioConvolveFX = class C3AudioConvolveFX extends AudioFXBase {
        constructor(audioDomHandler, buffer, normalize, mix) {
            super(audioDomHandler);
            this._type = "convolution";
            this._params = [normalize, mix];
            this._bufferOriginalUrl = "";
            this._bufferUrl = "";
            this._bufferType = "";
            this._inputNode = this.CreateGain();
            this._wetNode = this.CreateGain();
            this._wetNode["gain"]["value"] = mix;
            this._dryNode = this.CreateGain();
            this._dryNode["gain"]["value"] = 1 - mix;
            this._convolveNode = this._audioContext["createConvolver"]();
            this._convolveNode["normalize"] = normalize;
            this._convolveNode["buffer"] = buffer;
            this._inputNode["connect"](this._convolveNode);
            this._inputNode["connect"](this._dryNode);
            this._convolveNode["connect"](this._wetNode);
        }
        Release() {
            this._inputNode["disconnect"]();
            this._convolveNode["disconnect"]();
            this._wetNode["disconnect"]();
            this._dryNode["disconnect"]();
            super.Release();
        }
        ConnectTo(node) {
            this._wetNode["disconnect"]();
            this._wetNode["connect"](node);
            this._dryNode["disconnect"]();
            this._dryNode["connect"](node);
        }
        GetInputNode() {
            return this._inputNode;
        }
        SetParam(param, value, ramp, time) {
            switch (param) {
                case 0:
                    value = Math.max(Math.min(value / 100, 1), 0);
                    this._params[1] = value;
                    this.SetAudioParam(this._wetNode["gain"], value, ramp, time);
                    this.SetAudioParam(this._dryNode["gain"], 1 - value, ramp, time);
                    break;
            }
        }
        _SetBufferInfo(bufferOriginalUrl, bufferUrl, bufferType) {
            this._bufferOriginalUrl = bufferOriginalUrl;
            this._bufferUrl = bufferUrl;
            this._bufferType = bufferType;
        }
        GetState() {
            const ret = super.GetState();
            ret["bufferOriginalUrl"] = this._bufferOriginalUrl;
            ret["bufferUrl"] = "";
            ret["bufferType"] = this._bufferType;
            return ret;
        }
    };
    self.C3AudioFlangerFX = class C3AudioFlangerFX extends AudioFXBase {
        constructor(audioDomHandler, delay, modulation, freq, feedback, mix) {
            super(audioDomHandler);
            this._type = "flanger";
            this._params = [delay, modulation, freq, feedback, mix];
            this._inputNode = this.CreateGain();
            this._dryNode = this.CreateGain();
            this._dryNode["gain"]["value"] = 1 - mix / 2;
            this._wetNode = this.CreateGain();
            this._wetNode["gain"]["value"] = mix / 2;
            this._feedbackNode = this.CreateGain();
            this._feedbackNode["gain"]["value"] = feedback;
            this._delayNode = this._audioContext["createDelay"](delay + modulation);
            this._delayNode["delayTime"]["value"] = delay;
            this._oscNode = this._audioContext["createOscillator"]();
            this._oscNode["frequency"]["value"] = freq;
            this._oscGainNode = this.CreateGain();
            this._oscGainNode["gain"]["value"] = modulation;
            this._inputNode["connect"](this._delayNode);
            this._inputNode["connect"](this._dryNode);
            this._delayNode["connect"](this._wetNode);
            this._delayNode["connect"](this._feedbackNode);
            this._feedbackNode["connect"](this._delayNode);
            this._oscNode["connect"](this._oscGainNode);
            this._oscGainNode["connect"](this._delayNode["delayTime"]);
            this._oscNode["start"](0);
        }
        Release() {
            this._oscNode["stop"](0);
            this._inputNode["disconnect"]();
            this._delayNode["disconnect"]();
            this._oscNode["disconnect"]();
            this._oscGainNode["disconnect"]();
            this._dryNode["disconnect"]();
            this._wetNode["disconnect"]();
            this._feedbackNode["disconnect"]();
            super.Release();
        }
        ConnectTo(node) {
            this._wetNode["disconnect"]();
            this._wetNode["connect"](node);
            this._dryNode["disconnect"]();
            this._dryNode["connect"](node);
        }
        GetInputNode() {
            return this._inputNode;
        }
        SetParam(param, value, ramp, time) {
            switch (param) {
                case 0:
                    value = Math.max(Math.min(value / 100, 1), 0);
                    this._params[4] = value;
                    this.SetAudioParam(this._wetNode["gain"], value / 2, ramp, time);
                    this.SetAudioParam(this._dryNode["gain"], 1 - value / 2, ramp, time);
                    break;
                case 6:
                    this._params[1] = value / 1e3;
                    this.SetAudioParam(
                        this._oscGainNode["gain"],
                        value / 1e3,
                        ramp,
                        time
                    );
                    break;
                case 7:
                    this._params[2] = value;
                    this.SetAudioParam(this._oscNode["frequency"], value, ramp, time);
                    break;
                case 8:
                    this._params[3] = value / 100;
                    this.SetAudioParam(
                        this._feedbackNode["gain"],
                        value / 100,
                        ramp,
                        time
                    );
                    break;
            }
        }
    };
    self.C3AudioPhaserFX = class C3AudioPhaserFX extends AudioFXBase {
        constructor(audioDomHandler, freq, detune, q, modulation, modfreq, mix) {
            super(audioDomHandler);
            this._type = "phaser";
            this._params = [freq, detune, q, modulation, modfreq, mix];
            this._inputNode = this.CreateGain();
            this._dryNode = this.CreateGain();
            this._dryNode["gain"]["value"] = 1 - mix / 2;
            this._wetNode = this.CreateGain();
            this._wetNode["gain"]["value"] = mix / 2;
            this._filterNode = this._audioContext["createBiquadFilter"]();
            this._filterNode["type"] = "allpass";
            this._filterNode["frequency"]["value"] = freq;
            this._filterNode["detune"]["value"] = detune;
            this._filterNode["Q"]["value"] = q;
            this._oscNode = this._audioContext["createOscillator"]();
            this._oscNode["frequency"]["value"] = modfreq;
            this._oscGainNode = this.CreateGain();
            this._oscGainNode["gain"]["value"] = modulation;
            this._inputNode["connect"](this._filterNode);
            this._inputNode["connect"](this._dryNode);
            this._filterNode["connect"](this._wetNode);
            this._oscNode["connect"](this._oscGainNode);
            this._oscGainNode["connect"](this._filterNode["frequency"]);
            this._oscNode["start"](0);
        }
        Release() {
            this._oscNode["stop"](0);
            this._inputNode["disconnect"]();
            this._filterNode["disconnect"]();
            this._oscNode["disconnect"]();
            this._oscGainNode["disconnect"]();
            this._dryNode["disconnect"]();
            this._wetNode["disconnect"]();
            super.Release();
        }
        ConnectTo(node) {
            this._wetNode["disconnect"]();
            this._wetNode["connect"](node);
            this._dryNode["disconnect"]();
            this._dryNode["connect"](node);
        }
        GetInputNode() {
            return this._inputNode;
        }
        SetParam(param, value, ramp, time) {
            switch (param) {
                case 0:
                    value = Math.max(Math.min(value / 100, 1), 0);
                    this._params[5] = value;
                    this.SetAudioParam(this._wetNode["gain"], value / 2, ramp, time);
                    this.SetAudioParam(this._dryNode["gain"], 1 - value / 2, ramp, time);
                    break;
                case 1:
                    this._params[0] = value;
                    this.SetAudioParam(this._filterNode["frequency"], value, ramp, time);
                    break;
                case 2:
                    this._params[1] = value;
                    this.SetAudioParam(this._filterNode["detune"], value, ramp, time);
                    break;
                case 3:
                    this._params[2] = value;
                    this.SetAudioParam(this._filterNode["Q"], value, ramp, time);
                    break;
                case 6:
                    this._params[3] = value;
                    this.SetAudioParam(this._oscGainNode["gain"], value, ramp, time);
                    break;
                case 7:
                    this._params[4] = value;
                    this.SetAudioParam(this._oscNode["frequency"], value, ramp, time);
                    break;
            }
        }
    };
    self.C3AudioGainFX = class C3AudioGainFX extends AudioFXBase {
        constructor(audioDomHandler, g) {
            super(audioDomHandler);
            this._type = "gain";
            this._params = [g];
            this._node = this.CreateGain();
            this._node["gain"]["value"] = g;
        }
        Release() {
            this._node["disconnect"]();
            super.Release();
        }
        ConnectTo(node) {
            this._node["disconnect"]();
            this._node["connect"](node);
        }
        GetInputNode() {
            return this._node;
        }
        SetParam(param, value, ramp, time) {
            const DbToLinear = self.AudioDOMHandler.DbToLinear;
            switch (param) {
                case 4:
                    this._params[0] = DbToLinear(value);
                    this.SetAudioParam(this._node["gain"], DbToLinear(value), ramp, time);
                    break;
            }
        }
    };
    self.C3AudioTremoloFX = class C3AudioTremoloFX extends AudioFXBase {
        constructor(audioDomHandler, freq, mix) {
            super(audioDomHandler);
            this._type = "tremolo";
            this._params = [freq, mix];
            this._node = this.CreateGain();
            this._node["gain"]["value"] = 1 - mix / 2;
            this._oscNode = this._audioContext["createOscillator"]();
            this._oscNode["frequency"]["value"] = freq;
            this._oscGainNode = this.CreateGain();
            this._oscGainNode["gain"]["value"] = mix / 2;
            this._oscNode["connect"](this._oscGainNode);
            this._oscGainNode["connect"](this._node["gain"]);
            this._oscNode["start"](0);
        }
        Release() {
            this._oscNode["stop"](0);
            this._oscNode["disconnect"]();
            this._oscGainNode["disconnect"]();
            this._node["disconnect"]();
            super.Release();
        }
        ConnectTo(node) {
            this._node["disconnect"]();
            this._node["connect"](node);
        }
        GetInputNode() {
            return this._node;
        }
        SetParam(param, value, ramp, time) {
            switch (param) {
                case 0:
                    value = Math.max(Math.min(value / 100, 1), 0);
                    this._params[1] = value;
                    this.SetAudioParam(this._node["gain"], 1 - value / 2, ramp, time);
                    this.SetAudioParam(this._oscGainNode["gain"], value / 2, ramp, time);
                    break;
                case 7:
                    this._params[0] = value;
                    this.SetAudioParam(this._oscNode["frequency"], value, ramp, time);
                    break;
            }
        }
    };
    self.C3AudioRingModFX = class C3AudioRingModFX extends AudioFXBase {
        constructor(audioDomHandler, freq, mix) {
            super(audioDomHandler);
            this._type = "ringmod";
            this._params = [freq, mix];
            this._inputNode = this.CreateGain();
            this._wetNode = this.CreateGain();
            this._wetNode["gain"]["value"] = mix;
            this._dryNode = this.CreateGain();
            this._dryNode["gain"]["value"] = 1 - mix;
            this._ringNode = this.CreateGain();
            this._ringNode["gain"]["value"] = 0;
            this._oscNode = this._audioContext["createOscillator"]();
            this._oscNode["frequency"]["value"] = freq;
            this._oscNode["connect"](this._ringNode["gain"]);
            this._oscNode["start"](0);
            this._inputNode["connect"](this._ringNode);
            this._inputNode["connect"](this._dryNode);
            this._ringNode["connect"](this._wetNode);
        }
        Release() {
            this._oscNode["stop"](0);
            this._oscNode["disconnect"]();
            this._ringNode["disconnect"]();
            this._inputNode["disconnect"]();
            this._wetNode["disconnect"]();
            this._dryNode["disconnect"]();
            super.Release();
        }
        ConnectTo(node) {
            this._wetNode["disconnect"]();
            this._wetNode["connect"](node);
            this._dryNode["disconnect"]();
            this._dryNode["connect"](node);
        }
        GetInputNode() {
            return this._inputNode;
        }
        SetParam(param, value, ramp, time) {
            switch (param) {
                case 0:
                    value = Math.max(Math.min(value / 100, 1), 0);
                    this._params[1] = value;
                    this.SetAudioParam(this._wetNode["gain"], value, ramp, time);
                    this.SetAudioParam(this._dryNode["gain"], 1 - value, ramp, time);
                    break;
                case 7:
                    this._params[0] = value;
                    this.SetAudioParam(this._oscNode["frequency"], value, ramp, time);
                    break;
            }
        }
    };
    self.C3AudioDistortionFX = class C3AudioDistortionFX extends AudioFXBase {
        constructor(audioDomHandler, threshold, headroom, drive, makeupgain, mix) {
            super(audioDomHandler);
            this._type = "distortion";
            this._params = [threshold, headroom, drive, makeupgain, mix];
            this._inputNode = this.CreateGain();
            this._preGain = this.CreateGain();
            this._postGain = this.CreateGain();
            this._SetDrive(drive, makeupgain);
            this._wetNode = this.CreateGain();
            this._wetNode["gain"]["value"] = mix;
            this._dryNode = this.CreateGain();
            this._dryNode["gain"]["value"] = 1 - mix;
            this._waveShaper = this._audioContext["createWaveShaper"]();
            this._curve = new Float32Array(65536);
            this._GenerateColortouchCurve(threshold, headroom);
            this._waveShaper.curve = this._curve;
            this._inputNode["connect"](this._preGain);
            this._inputNode["connect"](this._dryNode);
            this._preGain["connect"](this._waveShaper);
            this._waveShaper["connect"](this._postGain);
            this._postGain["connect"](this._wetNode);
        }
        Release() {
            this._inputNode["disconnect"]();
            this._preGain["disconnect"]();
            this._waveShaper["disconnect"]();
            this._postGain["disconnect"]();
            this._wetNode["disconnect"]();
            this._dryNode["disconnect"]();
            super.Release();
        }
        _SetDrive(drive, makeupgain) {
            if (drive < 0.01) drive = 0.01;
            this._preGain["gain"]["value"] = drive;
            this._postGain["gain"]["value"] = Math.pow(1 / drive, 0.6) * makeupgain;
        }
        _GenerateColortouchCurve(threshold, headroom) {
            const n = 65536;
            const n2 = n / 2;
            for (let i = 0; i < n2; ++i) {
                let x = i / n2;
                x = this._Shape(x, threshold, headroom);
                this._curve[n2 + i] = x;
                this._curve[n2 - i - 1] = -x;
            }
        }
        _Shape(x, threshold, headroom) {
            const maximum = 1.05 * headroom * threshold;
            const kk = maximum - threshold;
            const sign = x < 0 ? -1 : +1;
            const absx = x < 0 ? -x : x;
            let shapedInput =
                absx < threshold
                    ? absx
                    : threshold + kk * self.AudioDOMHandler.e4(absx - threshold, 1 / kk);
            shapedInput *= sign;
            return shapedInput;
        }
        ConnectTo(node) {
            this._wetNode["disconnect"]();
            this._wetNode["connect"](node);
            this._dryNode["disconnect"]();
            this._dryNode["connect"](node);
        }
        GetInputNode() {
            return this._inputNode;
        }
        SetParam(param, value, ramp, time) {
            switch (param) {
                case 0:
                    value = Math.max(Math.min(value / 100, 1), 0);
                    this._params[4] = value;
                    this.SetAudioParam(this._wetNode["gain"], value, ramp, time);
                    this.SetAudioParam(this._dryNode["gain"], 1 - value, ramp, time);
                    break;
            }
        }
    };
    self.C3AudioCompressorFX = class C3AudioCompressorFX extends AudioFXBase {
        constructor(audioDomHandler, threshold, knee, ratio, attack, release) {
            super(audioDomHandler);
            this._type = "compressor";
            this._params = [threshold, knee, ratio, attack, release];
            this._node = this._audioContext["createDynamicsCompressor"]();
            this._node["threshold"]["value"] = threshold;
            this._node["knee"]["value"] = knee;
            this._node["ratio"]["value"] = ratio;
            this._node["attack"]["value"] = attack;
            this._node["release"]["value"] = release;
        }
        Release() {
            this._node["disconnect"]();
            super.Release();
        }
        ConnectTo(node) {
            this._node["disconnect"]();
            this._node["connect"](node);
        }
        GetInputNode() {
            return this._node;
        }
        SetParam(param, value, ramp, time) {}
    };
    self.C3AudioAnalyserFX = class C3AudioAnalyserFX extends AudioFXBase {
        constructor(audioDomHandler, fftSize, smoothing) {
            super(audioDomHandler);
            this._type = "analyser";
            this._params = [fftSize, smoothing];
            this._node = this._audioContext["createAnalyser"]();
            this._node["fftSize"] = fftSize;
            this._node["smoothingTimeConstant"] = smoothing;
            this._freqBins = new Float32Array(this._node["frequencyBinCount"]);
            this._signal = new Uint8Array(fftSize);
            this._peak = 0;
            this._rms = 0;
            this._audioDomHandler._AddAnalyser(this);
        }
        Release() {
            this._audioDomHandler._RemoveAnalyser(this);
            this._node["disconnect"]();
            super.Release();
        }
        Tick() {
            this._node["getFloatFrequencyData"](this._freqBins);
            this._node["getByteTimeDomainData"](this._signal);
            const fftSize = this._node["fftSize"];
            this._peak = 0;
            let rmsSquaredSum = 0;
            for (let i = 0; i < fftSize; ++i) {
                let s = (this._signal[i] - 128) / 128;
                if (s < 0) s = -s;
                if (this._peak < s) this._peak = s;
                rmsSquaredSum += s * s;
            }
            const LinearToDb = self.AudioDOMHandler.LinearToDb;
            this._peak = LinearToDb(this._peak);
            this._rms = LinearToDb(Math.sqrt(rmsSquaredSum / fftSize));
        }
        ConnectTo(node) {
            this._node["disconnect"]();
            this._node["connect"](node);
        }
        GetInputNode() {
            return this._node;
        }
        SetParam(param, value, ramp, time) {}
        GetData() {
            return {
                tag: this.GetTag(),
                index: this.GetIndex(),
                peak: this._peak,
                rms: this._rms,
                binCount: this._node["frequencyBinCount"],
                freqBins: this._freqBins,
            };
        }
    };
}
("use strict");
{
    const DOM_COMPONENT_ID = "instant-games";
    function Wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    const HANDLER_CLASS = class InstantGamesDOMHandler extends self.DOMHandler {
        constructor(iRuntime) {
            super(iRuntime, DOM_COMPONENT_ID);
            this._hasInitialized = false;
            this._isAvailable = false;
            this._FBInstant = null;
            this._loadedInterstitialAd = null;
            this._loadedRewardedVideoAd = null;
            this.AddRuntimeMessageHandlers([
                ["load", (e) => this._OnLoad(e)],
                ["loading-progress", (e) => this._OnLoadingProgress(e)],
                ["start-game", () => this._OnStartGame()],
                ["quit", () => this._OnQuit()],
                ["set-player-data", (e) => this._OnSetPlayerData(e)],
                ["load-player-data", () => this._OnLoadPlayerData()],
                ["share", (e) => this._OnShare(e)],
                ["custom-update", (e) => this._OnCustomUpdate(e)],
                ["switch-game", (e) => this._OnSwitchGame(e)],
                ["change-context", (e) => this._OnChangeContext(e)],
                ["log-event", (e) => this._OnLogEvent(e)],
                ["load-connected-players", () => this._OnLoadConnectedPlayers()],
                ["set-score", (e) => this._OnSetScore(e)],
                ["load-player-score", (e) => this._OnLoadPlayerScore(e)],
                ["share-leaderboard-update", (e) => this._OnShareLeaderboardUpdate(e)],
                ["load-leaderboard", (e) => this._LoadLeaderboard(e)],
                ["create-shortcut", () => this._OnCreateShortcut()],
                ["subscribe-bot", () => this._OnSubscribeBot()],
                ["load-ad", (e) => this._OnLoadAd(e)],
                ["show-ad", (e) => this._OnShowAd(e)],
            ]);
        }
        async _OnLoad(e) {
            if (e["exportType"] !== "instant-games") {
                console.warn(
                    "[Instant Games] Project has not been exported with the 'Instant Games' export option, so Instant Games features will be unavailable"
                );
                return false;
            }
            this._FBInstant = window["FBInstant"];
            if (!this._FBInstant) return false;
            await Promise.race([this._InitializeFBInstant(), Wait(4e3)]);
            this._isAvailable = this._hasInitialized;
            if (this._isAvailable) console.info("[Instant Games] Initialized OK");
            else
                console.warn(
                    "[Instant Games] Initialization timed out after 4 seconds. Continuing with Instant Games disabled."
                );
            return this._isAvailable;
        }
        async _InitializeFBInstant() {
            try {
                await this._FBInstant["initializeAsync"]();
                this._hasInitialized = true;
            } catch (err) {
                console.error("[Instant Games] Failed to initialize: ", err);
            }
        }
        _OnLoadingProgress(e) {
            if (!this._isAvailable) return;
            this._FBInstant["setLoadingProgress"](e["progress"]);
        }
        async _OnStartGame() {
            if (!this._isAvailable) return null;
            const FBInstant = this._FBInstant;
            await FBInstant["startGameAsync"]();
            FBInstant["onPause"](() => this.PostToRuntime("pause"));
            const FBContext = FBInstant["context"];
            const FBPlayer = FBInstant["player"];
            const entryPointObj = FBInstant["getEntryPointData"]();
            let entryPointData = "";
            if (entryPointObj && entryPointObj.hasOwnProperty("data"))
                entryPointData = entryPointObj["data"];
            return {
                locale: FBInstant["getLocale"](),
                platform: FBInstant["getPlatform"](),
                sdkVersion: FBInstant["getSDKVersion"](),
                contextId: FBContext["getID"](),
                contextType: FBContext["getType"](),
                playerName: FBPlayer["getName"](),
                playerPhoto: FBPlayer["getPhoto"](),
                playerId: FBPlayer["getID"](),
                entryPointData: entryPointData,
                supportedApis: FBInstant["getSupportedAPIs"](),
            };
        }
        PostError() {
            this.PostToRuntime("error");
        }
        _OnQuit() {
            if (!this._isAvailable) return;
            this._FBInstant["quit"]();
        }
        async _OnSetPlayerData(e) {
            if (!this._isAvailable) return;
            try {
                await this._FBInstant["player"]["setDataAsync"]({ data: e["data"] });
            } catch (err) {
                console.error("[Instant Games] Failed to set player data: ", err);
                this.PostError();
            }
        }
        async _OnLoadPlayerData() {
            if (!this._isAvailable) return "";
            try {
                const o = await this._FBInstant["player"]["getDataAsync"](["data"]);
                if (o && o.hasOwnProperty("data")) return o["data"];
            } catch (err) {
                console.error("[Instant Games] Failed to load player data: ", err);
                this.PostError();
            }
            return "";
        }
        async _OnShare(e) {
            if (!this._isAvailable) return;
            try {
                await this._FBInstant["shareAsync"]({
                    intent: e["intent"],
                    image: e["image"],
                    text: e["text"],
                    data: { data: e["data"] },
                });
            } catch (err) {
                console.error("[Instant Games] Failed to share: ", err);
                this.PostError();
            }
        }
        async _OnCustomUpdate(e) {
            if (!this._isAvailable) return;
            try {
                const opts = {
                    action: "CUSTOM",
                    template: e["templateId"],
                    image: e["image"],
                    text: e["text"],
                    data: { data: e["data"] },
                    strategy: e["strategy"],
                    notification: e["notification"],
                };
                const cta = e["cta"];
                if (cta) opts["cta"] = cta;
                await this._FBInstant["updateAsync"](opts);
            } catch (err) {
                console.error("[Instant Games] Error posting custom update: ", err);
            }
        }
        async _OnSwitchGame(e) {
            if (!this._isAvailable) return;
            try {
                await this._FBInstant["switchGameAsync"](e["appId"], {
                    data: e["data"],
                });
            } catch (err) {
                console.error("[Instant Games] Failed to switch game: ", err);
                this.PostError();
            }
        }
        async _OnChangeContext(e) {
            if (!this._isAvailable) return { isOk: false };
            try {
                const opts = {};
                const filter = e["filter"];
                if (filter === 1) opts["filters"] = ["NEW_CONTEXT_ONLY"];
                else if (filter === 2)
                    opts["filters"] = ["INCLUDE_EXISTING_CHALLENGES"];
                else if (filter === 3) opts["filters"] = ["NEW_PLAYERS_ONLY"];
                const minSize = e["minSize"];
                const maxSize = e["maxSize"];
                if (minSize >= 0) opts["minSize"] = minSize;
                if (maxSize >= 0) opts["maxSize"] = maxSize;
                const FBContext = this._FBInstant["context"];
                await FBContext["chooseAsync"](opts);
                return {
                    isOk: true,
                    newContextId: FBContext["getID"](),
                    newContextType: FBContext["getType"](),
                };
            } catch (err) {
                if (err["code"] === "USER_INPUT")
                    return { isOk: false, cancelled: true };
                else {
                    console.warn("[Instant Games] Failed to change context: ", err);
                    return { isOk: false };
                }
            }
        }
        _OnLogEvent(e) {
            if (!this._isAvailable) return;
            this._FBInstant["logEvent"](e["name"], e["valueToSum"]);
        }
        async _OnLoadConnectedPlayers() {
            if (!this._isAvailable) return { isOk: false };
            try {
                const result = await this._FBInstant["player"][
                    "getConnectedPlayersAsync"
                    ]();
                return {
                    isOk: true,
                    connectedPlayers: result.map((p) => ({
                        id: p["getID"](),
                        name: p["getName"](),
                        photo: p["getPhoto"](),
                    })),
                };
            } catch (err) {
                console.error("[Instant Games] Failed to share: ", err);
                this.PostError();
                return { isOk: false };
            }
        }
        async _OnSetScore(e) {
            if (!this._isAvailable) return false;
            try {
                const leaderboard = await this._FBInstant["getLeaderboardAsync"](
                    e["leaderboardId"]
                );
                await leaderboard["setScoreAsync"](e["score"]);
                return true;
            } catch (err) {
                console.error("[Instant Games] Failed to set score: ", err);
                this.PostError();
                return false;
            }
        }
        async _OnLoadPlayerScore(e) {
            if (!this._isAvailable) return { isOk: false };
            try {
                const leaderboard = await this._FBInstant["getLeaderboardAsync"](
                    e["leaderboardId"]
                );
                const entry = await leaderboard["getPlayerEntryAsync"]();
                if (!entry) throw new Error("player has no score");
                return {
                    isOk: true,
                    score: entry["getScore"](),
                    rank: entry["getRank"](),
                };
            } catch (err) {
                console.error("[Instant Games] Failed to load player score: ", err);
                this.PostError();
                return { isOk: false };
            }
        }
        async _OnShareLeaderboardUpdate(e) {
            if (!this._isAvailable) return;
            try {
                await this._FBInstant["updateAsync"]({
                    action: "LEADERBOARD",
                    name: e["leaderboardId"],
                });
            } catch (err) {
                console.error(
                    "[Instant Games] Failed to share leaderboard update: ",
                    err
                );
            }
        }
        async _LoadLeaderboard(e) {
            if (!this._isAvailable) return { isOk: false };
            const count = e["count"];
            const offset = e["offset"];
            try {
                const leaderboard = await this._FBInstant["getLeaderboardAsync"](
                    e["leaderboardId"]
                );
                let entries;
                if (e["results"] === 0)
                    entries = await leaderboard["getEntriesAsync"](count, offset);
                else
                    entries = await leaderboard["getConnectedPlayerEntriesAsync"](
                        count,
                        offset
                    );
                return {
                    isOk: true,
                    leaderboardEntries: entries.map((e) => ({
                        score: e["getScore"](),
                        rank: e["getRank"](),
                        playerId: e["getPlayer"]()["getID"](),
                        playerName: e["getPlayer"]()["getName"](),
                        playerPhoto: e["getPlayer"]()["getPhoto"](),
                    })),
                };
            } catch (err) {
                console.error("[Instant Games] Failed to load leaderboard: ", err);
                this.PostError();
                return { isOk: false };
            }
        }
        async _OnCreateShortcut() {
            if (!this._isAvailable) return false;
            try {
                const canCreateShortcut = await this._FBInstant[
                    "canCreateShortcutAsync"
                    ]();
                if (!canCreateShortcut) return false;
                await this._FBInstant["createShortcutAsync"]();
                return true;
            } catch (err) {
                console.error("[Instant Games] Failed to create shortcut: ", err);
                return false;
            }
        }
        async _OnSubscribeBot() {
            if (!this._isAvailable) return;
            const FBPlayer = this._FBInstant["player"];
            try {
                const canSubscribeBot = await FBPlayer["canSubscribeBotAsync"]();
                if (!canSubscribeBot)
                    throw new Error("not allowed by canSubscribeBotAsync()");
                await FBPlayer["subscribeBotAsync"]();
                console.log("[Instant Games] Successfully subscribed to bot");
            } catch (err) {
                console.error("[Instant Games] Failed to subscribe bot: ", err);
            }
        }
        async _OnLoadAd(e) {
            if (!this._isAvailable) return false;
            const placementId = e["placementId"];
            try {
                const isInterstitial = e["type"] === 0;
                let adInstance;
                if (isInterstitial)
                    adInstance = await this._FBInstant["getInterstitialAdAsync"](
                        placementId
                    );
                else
                    adInstance = await this._FBInstant["getRewardedVideoAsync"](
                        placementId
                    );
                await adInstance["loadAsync"]();
                if (isInterstitial) this._loadedInterstitialAd = adInstance;
                else this._loadedRewardedVideoAd = adInstance;
                return true;
            } catch (err) {
                console.error("[Instant Games] Failed to load ad: ", err);
                return false;
            }
        }
        async _OnShowAd(e) {
            if (!this._isAvailable) return false;
            const loadedAd =
                e["type"] === 0
                    ? this._loadedInterstitialAd
                    : this._loadedRewardedVideoAd;
            if (!loadedAd) return false;
            try {
                await loadedAd["showAsync"]();
                return true;
            } catch (err) {
                console.error("[Instant Games] Failed to show ad: ", err);
                return false;
            }
        }
    };
    self.RuntimeInterface.AddDOMHandlerClass(HANDLER_CLASS);
}
("use strict");
{
    const DOM_COMPONENT_ID = "mouse";
    const HANDLER_CLASS = class MouseDOMHandler extends self.DOMHandler {
        constructor(iRuntime) {
            super(iRuntime, DOM_COMPONENT_ID);
            this.AddRuntimeMessageHandler("cursor", (e) =>
                this._OnChangeCursorStyle(e)
            );
        }
        _OnChangeCursorStyle(e) {
            document.documentElement.style.cursor = e;
        }
    };
    self.RuntimeInterface.AddDOMHandlerClass(HANDLER_CLASS);
}
("use strict");
{
    const DOM_COMPONENT_ID = "button";
    function StopPropagation(e) {
        e.stopPropagation();
    }
    const HANDLER_CLASS = class ButtonDOMHandler extends self.DOMElementHandler {
        constructor(iRuntime) {
            super(iRuntime, DOM_COMPONENT_ID);
        }
        CreateElement(elementId, e) {
            const inputElem = document.createElement("input");
            const isCheckbox = e["isCheckbox"];
            let mainElem = inputElem;
            if (isCheckbox) {
                inputElem.type = "checkbox";
                const labelElem = document.createElement("label");
                labelElem.appendChild(inputElem);
                labelElem.appendChild(document.createTextNode(""));
                labelElem.style.fontFamily = "sans-serif";
                labelElem.style.userSelect = "none";
                labelElem.style.webkitUserSelect = "none";
                labelElem.style.display = "inline-block";
                labelElem.style.color = "black";
                mainElem = labelElem;
            } else inputElem.type = "button";
            mainElem.style.position = "absolute";
            mainElem.addEventListener("touchstart", StopPropagation);
            mainElem.addEventListener("touchmove", StopPropagation);
            mainElem.addEventListener("touchend", StopPropagation);
            mainElem.addEventListener("mousedown", StopPropagation);
            mainElem.addEventListener("mouseup", StopPropagation);
            mainElem.addEventListener("keydown", StopPropagation);
            mainElem.addEventListener("keyup", StopPropagation);
            inputElem.addEventListener("click", () =>
                this._PostToRuntimeElementMaybeSync("click", elementId, {
                    isChecked: inputElem.checked,
                })
            );
            if (e["id"]) inputElem.id = e["id"];
            this.UpdateState(mainElem, e);
            return mainElem;
        }
        _GetInputElem(mainElem) {
            if (mainElem.tagName.toLowerCase() === "input") return mainElem;
            else return mainElem.firstChild;
        }
        _GetFocusElement(mainElem) {
            return this._GetInputElem(mainElem);
        }
        UpdateState(mainElem, e) {
            const inputElem = this._GetInputElem(mainElem);
            inputElem.checked = e["isChecked"];
            inputElem.disabled = !e["isEnabled"];
            mainElem.title = e["title"];
            if (mainElem === inputElem) inputElem.value = e["text"];
            else mainElem.lastChild.textContent = e["text"];
        }
    };
    self.RuntimeInterface.AddDOMHandlerClass(HANDLER_CLASS);
}
("use strict");
{
    const DOM_COMPONENT_ID = "text-input";
    function StopPropagation(e) {
        e.stopPropagation();
    }
    function StopKeyPropagation(e) {
        if (e.which !== 13 && e.which !== 27) e.stopPropagation();
    }
    const HANDLER_CLASS = class TextInputDOMHandler extends self.DOMElementHandler {
        constructor(iRuntime) {
            super(iRuntime, DOM_COMPONENT_ID);
            this.AddDOMElementMessageHandler("scroll-to-bottom", (elem) =>
                this._OnScrollToBottom(elem)
            );
        }
        CreateElement(elementId, e) {
            let elem;
            const type = e["type"];
            if (type === "textarea") {
                elem = document.createElement("textarea");
                elem.style.resize = "none";
            } else {
                elem = document.createElement("input");
                elem.type = type;
            }
            elem.style.position = "absolute";
            elem.autocomplete = "off";
            elem.addEventListener("touchstart", StopPropagation);
            elem.addEventListener("touchmove", StopPropagation);
            elem.addEventListener("touchend", StopPropagation);
            elem.addEventListener("mousedown", StopPropagation);
            elem.addEventListener("mouseup", StopPropagation);
            elem.addEventListener("keydown", StopKeyPropagation);
            elem.addEventListener("keyup", StopKeyPropagation);
            elem.addEventListener("click", (e) => {
                e.stopPropagation();
                this._PostToRuntimeElementMaybeSync("click", elementId);
            });
            elem.addEventListener("dblclick", (e) => {
                e.stopPropagation();
                this._PostToRuntimeElementMaybeSync("dblclick", elementId);
            });
            elem.addEventListener("input", () =>
                this.PostToRuntimeElement("change", elementId, { text: elem.value })
            );
            if (e["id"]) elem.id = e["id"];
            this.UpdateState(elem, e);
            return elem;
        }
        UpdateState(elem, e) {
            elem.value = e["text"];
            elem.placeholder = e["placeholder"];
            elem.title = e["title"];
            elem.disabled = !e["isEnabled"];
            elem.readOnly = e["isReadOnly"];
            elem.spellcheck = e["spellCheck"];
            const maxLength = e["maxLength"];
            if (maxLength < 0) elem.removeAttribute("maxlength");
            else elem.setAttribute("maxlength", maxLength);
        }
        _OnScrollToBottom(elem) {
            elem.scrollTop = elem.scrollHeight;
        }
    };
    self.RuntimeInterface.AddDOMHandlerClass(HANDLER_CLASS);
}
