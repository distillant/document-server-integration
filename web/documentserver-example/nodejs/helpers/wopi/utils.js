/**
 *
 * (c) Copyright Ascensio System SIA 2021
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

const config = require("config");
const configServer = config.get("server");
const syncRequest = require("sync-request");
const xmlParser = require("fast-xml-parser");
const he = require("he");

var cache = null;

// get the wopi discovery information
function getDiscoveryInfo(siteUrl, maxTry = 1) {
    let actions = [];

    if (cache) return cache;

    try {
        let response = syncRequest("GET", siteUrl + configServer.get("wopi.discovery"));
        let discovery = xmlParser.parse(response.getBody().toString(), {  // create the discovery XML file with the parameters from the response
            attributeNamePrefix: "",
            ignoreAttributes: false,
            parseAttributeValue: true,
            attrValueProcessor: (val, attrName) => he.decode(val, { isAttributeValue: true })
        });
        for (let app of discovery["wopi-discovery"]["net-zone"].app) {
            if (!Array.isArray(app.action)) { app.action = [app.action]; }
            for (let action of app.action) {
                actions.push({  // write all the parameters to the actions element
                    app: app.name,
                    favIconUrl: app.favIconUrl,
                    checkLicense: app.checkLicense == 'true',
                    name: action.name,
                    ext: action.ext || "",
                    progid: action.progid || "",
                    isDefault: action.default ? true : false,
                    urlsrc: action.urlsrc,
                    requires: action.requires || ""
                });
            }
        }
    } catch (e) {
        if (--maxTry > 0) {
            setTimeout(getDiscoveryInfo, 1000, maxTry);
        }
        return actions;
    }

    cache = actions;
    setTimeout(() => cache = null, 1000 * 60 * 60); // 1 hour

    return actions;
}

// get actions of the specified extension
function getActions(ext) {
    let actions = getDiscoveryInfo();  // get the wopi discovery information
    let filtered = [];

    for (let action of actions) {  // and filter it by the specified extention
        if (action.ext == ext) {
            filtered.push(action);
        }
    }

    return filtered;
}

// get an action for the specified extension and name
function getAction(ext, name) {
    let actions = getDiscoveryInfo();

    for (let action of actions) {
        if (action.ext == ext && action.name == name) {
            return action;
        }
    }

    return null;
}

// get the default action for the specified extension
function getDefaultAction(ext) {
    let actions = getDiscoveryInfo();

    for (let action of actions) {
        if (action.ext == ext && action.isDefault) {
            return action;
        }
    }

    return null;
}

// get the action url
function getActionUrl(host, userAddress, action, filename) {
    return action.urlsrc.replace(/<.*&>/g, "") + "WOPISrc=" + host + "/wopi/files/" + filename + "@" + userAddress;
}

exports.getDiscoveryInfo = getDiscoveryInfo;
exports.getAction = getAction;
exports.getActions = getActions;
exports.getActionUrl = getActionUrl;
exports.getDefaultAction = getDefaultAction;