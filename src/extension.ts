'use strict';

import * as vscode from 'vscode';
import { PluginService, ExtensionInformation } from './pluginService';
import * as path from 'path';
import { Environment } from './environmentPath';
import { File, FileManager } from './fileManager';
import { Commons } from './commons';
import { GithubService } from './githubService';
import { ExtensionConfig, LocalConfig, CloudSetting } from './setting';
import { OsType, SettingType } from './enums';

export async function activate(context: vscode.ExtensionContext) {


    var openurl = require('open');
    var fs = require('fs');

    var en: Environment = new Environment(context);
    var common: Commons = new Commons(en, context);

    await common.StartMigrationProcess();

    await common.InitializeSettings(false, false).then(async (resolve: ExtensionConfig) => {

        if (resolve) {
            let tokenAvailable: boolean = (resolve.Token != null) && (resolve.Token != "");
            let gistAvailable: boolean = (resolve.Gist != null) && (resolve.Gist != "");

            if (resolve.autoUpload && tokenAvailable && gistAvailable) {
                common.StartWatch();
            }
            
            if (tokenAvailable == true && gistAvailable == true && resolve.autoDownload == true) {
                vscode.commands.executeCommand('extension.downloadSettings');
            }
            else {

            }
        }

    }, (reject) => {
        common.LogException(reject, common.ERROR_MESSAGE, false);
    });

    // var tokenAvailable: boolean = newSetting.Token != null && newSetting.Token != "";
    // var gistAvailable: boolean = newSetting.Gist != null && newSetting.Gist != "";

    // let appSetting: string = en.APP_SETTINGS;
    // let appSummary: string = en.APP_SUMMARY;

    // while (appSetting.indexOf("/") > -1) {
    //     appSetting = appSetting.replace("/", "\\");
    // }

    // while (appSummary.indexOf("/") > -1) {
    //     appSummary = appSummary.replace("/", "\\");
    // }



    var updateSettings = vscode.commands.registerCommand('extension.updateSettings', async function () {

        let args = arguments;

        var en: Environment = new Environment(context);
        var common: Commons = new Commons(en, context);
        common.CloseWatch();

        var myGi: GithubService = null;
        var dateNow: Date = new Date();
        var localConfig: LocalConfig = new LocalConfig();
        var syncSetting: ExtensionConfig = null;
        var allSettingFiles = new Array<File>();
        var uploadedExtensions = new Array<ExtensionInformation>();

        await common.InitializeSettings(true, false).then(async (resolve) => {

            localConfig.config = resolve;
            syncSetting = localConfig.config;

            if (args.length > 0) {
                if (args[0] == "publicGIST") {
                    localConfig.publicGist = true;
                }
                else {
                    localConfig.publicGist = false;
                }
            }
            myGi = new GithubService(syncSetting.Token);

            await startGitProcess();

        }, (reject) => {
            common.LogException(reject, common.ERROR_MESSAGE, true);
            return;
        });

        async function startGitProcess() {

            vscode.window.setStatusBarMessage("Sync : Uploading / Updating Your Settings In Github.");

            if (syncSetting.Token != null && syncSetting.Token != "") {

                syncSetting.lastUpload = dateNow;
                vscode.window.setStatusBarMessage("Sync : Reading Settings and Extensions.");

                var settingFile: File = await FileManager.GetFile(en.FILE_SETTING, en.FILE_SETTING_NAME);
                var launchFile: File = await FileManager.GetFile(en.FILE_LAUNCH, en.FILE_LAUNCH_NAME);

                var destinationKeyBinding: string = "";
                if (en.OsType == OsType.Mac) {
                    destinationKeyBinding = en.FILE_KEYBINDING_MAC;
                }
                else {
                    destinationKeyBinding = en.FILE_KEYBINDING_DEFAULT;
                }

                var keybindingFile: File = await FileManager.GetFile(en.FILE_KEYBINDING, destinationKeyBinding);
                var localeFile: File = await FileManager.GetFile(en.FILE_LOCALE, en.FILE_LOCALE_NAME);

                if (settingFile) {
                    allSettingFiles.push(settingFile);
                }
                if (launchFile) {
                    allSettingFiles.push(launchFile);
                }
                if (keybindingFile) {
                    allSettingFiles.push(keybindingFile);
                }
                if (localeFile) {
                    allSettingFiles.push(localeFile);
                }

                uploadedExtensions = PluginService.CreateExtensionList();

                uploadedExtensions.sort(function (a, b) {
                    return a.name.localeCompare(b.name);
                });


                // var remoteList = ExtensionInformation.fromJSONList(file.content);
                // var deletedList = PluginService.GetDeletedExtensions(uploadedExtensions);



                var fileName = en.FILE_EXTENSION_NAME;
                var filePath = en.FILE_EXTENSION;
                var fileContent = JSON.stringify(uploadedExtensions, undefined, 2);;
                var file: File = new File(fileName, fileContent, filePath);
                allSettingFiles.push(file);

                var snippetFiles = await FileManager.ListFiles(en.FOLDER_SNIPPETS);
                snippetFiles.forEach(snippetFile => {
                    allSettingFiles.push(snippetFile);
                });

                var extProp: CloudSetting = new CloudSetting();
                extProp.lastUpload = dateNow;
                fileName = en.FILE_CLOUDSETTINGS_NAME;
                fileContent = JSON.stringify(extProp);
                file = new File(fileName, fileContent, "");
                allSettingFiles.push(file);

                var newGIST = false;
                if (syncSetting.Gist == null || syncSetting.Gist === "") {
                    newGIST = true;
                    await myGi.CreateEmptyGIST(localConfig.publicGist).then(async function (gistID: string) {
                        if (gistID) {
                            syncSetting.Gist = gistID;
                            vscode.window.setStatusBarMessage("Sync : Empty GIST ID: " + syncSetting.Gist + " created To insert files, in Process...");
                        }
                        else {
                            vscode.window.showInformationMessage("GIST UNABLE TO CREATE");
                            return;
                        }
                    }, function (error: any) {
                        common.LogException(error, common.ERROR_MESSAGE, true);
                        return;
                    });
                }

                await myGi.ReadGist(syncSetting.Gist).then(async function (gistObj: any) {

                    if (gistObj) {

                        if (gistObj.owner.login != myGi.userName) {
                            common.LogException(null, "Sync : You cant edit GIST for user : " + gistObj.owner.login, true);
                            return;
                        }

                        vscode.window.setStatusBarMessage("Sync : Uploading Files Data.");
                        gistObj = myGi.UpdateGIST(gistObj, allSettingFiles);

                        await myGi.SaveGIST(gistObj).then(async function (saved: boolean) {
                            if (saved) {
                                await common.SaveSettings(syncSetting).then(function (added: boolean) {
                                    if (added) {
                                        if (newGIST) {
                                            vscode.window.showInformationMessage("Uploaded Successfully." + " GIST ID :  " + syncSetting.Gist + " . Please copy and use this ID in other machines to sync all settings.");
                                        }
                                        else {
                                            vscode.window.setStatusBarMessage("");
                                            vscode.window.setStatusBarMessage("Uploaded Successfully.", 5000);
                                        }

                                        if (localConfig.publicGist) {
                                            vscode.window.showInformationMessage("Sync : You can share the GIST ID to other users to download your settings.");
                                        }

                                        if (syncSetting.showSummary) {
                                            common.GenerateSummmaryFile(true, allSettingFiles, null, uploadedExtensions, localConfig);

                                        }
                                        if (syncSetting.autoUpload) {
                                            common.StartWatch();
                                        }
                                        vscode.window.setStatusBarMessage("");
                                    }
                                }, function (err: any) {
                                    common.LogException(err, common.ERROR_MESSAGE, true);
                                    return;
                                });
                            }
                            else {
                                vscode.window.showErrorMessage("GIST NOT SAVED");
                                return;
                            }
                        }, function (error: any) {
                            common.LogException(error, common.ERROR_MESSAGE, true);
                            return;
                        });
                    }
                    else {
                        vscode.window.showErrorMessage("GIST ID: " + syncSetting.Gist + " UNABLE TO READ.");
                        return;
                    }
                }, function (gistReadError: any) {
                    common.LogException(gistReadError, common.ERROR_MESSAGE, true);
                    return;
                });
            }
            else {
                vscode.window.showErrorMessage("ERROR ! Github Account Token Not Set");
            }
        }
    });


    var downloadSettings = vscode.commands.registerCommand('extension.downloadSettings', async function () {

        var en: Environment = new Environment(context);
        var common: Commons = new Commons(en, context);
        common.CloseWatch();

        var myGi: GithubService = null;
        var localSettings: LocalConfig = new LocalConfig();
        var syncSetting: ExtensionConfig = new ExtensionConfig();

        await common.InitializeSettings(true, true).then(async (resolve) => {

            localSettings.config = resolve;
            syncSetting = localSettings.config;
            await StartDownload();
        });

        async function StartDownload() {

            myGi = new GithubService(syncSetting.Token);
            vscode.window.setStatusBarMessage("");
            vscode.window.setStatusBarMessage("Sync : Reading Settings Online.", 2000);

            myGi.ReadGist(syncSetting.Gist).then(async function (res: any) {

                var addedExtensions: Array<ExtensionInformation> = new Array<ExtensionInformation>();
                var deletedExtensions: Array<ExtensionInformation> = new Array<ExtensionInformation>();
                var updatedFiles: Array<File> = new Array<File>();
                var actionList = new Array<Promise<void | boolean>>();

                if (res) {
                    var keys = Object.keys(res.files);
                    if (keys.indexOf(en.FILE_CLOUDSETTINGS_NAME) > -1) {
                        var cloudSett: CloudSetting = JSON.parse(res.files[en.FILE_CLOUDSETTINGS_NAME].content);
                        cloudSett.lastUpload = new Date(cloudSett.lastUpload);
                        var stat: boolean = (syncSetting.lastUpload.getTime() === cloudSett.lastUpload.getTime()) || (syncSetting.lastDownload.getTime() === cloudSett.lastUpload.getTime());

                        if (!syncSetting.forceDownload) {
                            if (stat) {
                                vscode.window.setStatusBarMessage("");
                                vscode.window.setStatusBarMessage("Sync : You already have latest version of saved settings.", 5000);
                                return;
                            }
                        }
                        syncSetting.lastDownload = cloudSett.lastUpload;
                    }

                    keys.forEach(fileName => {
                        if (res.files[fileName]) {
                            if (res.files[fileName].content) {
                                if (fileName.indexOf(".") > -1) {
                                    var f: File = new File(fileName, res.files[fileName].content, null);
                                    updatedFiles.push(f);
                                }
                            }
                        }
                        else {
                            console.log(fileName + " key in response is empty.");
                        }

                    });

                    for (var index = 0; index < updatedFiles.length; index++) {

                        var file: File = updatedFiles[index];
                        var path: string = null;
                        var writeFile: boolean = false;
                        var content: string = null;

                        switch (file.fileName) {
                            case en.FILE_LAUNCH_NAME: {
                                writeFile = true;
                                path = en.FILE_LAUNCH;
                                content = file.content;

                                break;
                            }
                            case en.FILE_SETTING_NAME: {
                                writeFile = true;
                                path = en.FILE_SETTING;
                                content = file.content;

                                break;
                            }
                            case en.FILE_KEYBINDING_DEFAULT:
                            case en.FILE_KEYBINDING_MAC: {
                                writeFile = en.OsType == OsType.Mac ? file.fileName == en.FILE_KEYBINDING_MAC : file.fileName == en.FILE_KEYBINDING_DEFAULT;
                                path = en.FILE_KEYBINDING;
                                if (writeFile) {
                                    content = file.content;
                                }
                                break;
                            }
                            case en.FILE_LOCALE_NAME: {
                                writeFile = true;
                                path = en.FILE_LOCALE;
                                content = file.content;
                                break;
                            }
                            case en.FILE_EXTENSION_NAME: {
                                writeFile = false;

                                var extensionlist = PluginService.CreateExtensionList();

                                extensionlist.sort(function (a, b) {
                                    return a.name.localeCompare(b.name);
                                });

                                var remoteList = ExtensionInformation.fromJSONList(file.content);
                                var deletedList = PluginService.GetDeletedExtensions(remoteList);

                                for (var deletedItemIndex = 0; deletedItemIndex < deletedList.length; deletedItemIndex++) {
                                    var deletedExtension = deletedList[deletedItemIndex];
                                    (async function (deletedExtension: ExtensionInformation, ExtensionFolder: string) {
                                        await actionList.push(PluginService.DeleteExtension(deletedExtension, en.ExtensionFolder)
                                            .then((res) => {
                                                //vscode.window.showInformationMessage(deletedExtension.name + '-' + deletedExtension.version + " is removed.");
                                                deletedExtensions.push(deletedExtension);
                                            }, (rej) => {
                                                common.LogException(rej, common.ERROR_MESSAGE, true);
                                            }));
                                    } (deletedExtension, en.ExtensionFolder));

                                }

                                var missingList = PluginService.GetMissingExtensions(remoteList);
                                if (missingList.length == 0) {
                                    vscode.window.setStatusBarMessage("");
                                    vscode.window.setStatusBarMessage("Sync : No Extension needs to be installed.", 2000);
                                }
                                else {

                                    vscode.window.setStatusBarMessage("Sync : Installing Extensions in background.");
                                    missingList.forEach(async (element) => {

                                        await actionList.push(PluginService.InstallExtension(element, en.ExtensionFolder)
                                            .then(function () {
                                                addedExtensions.push(element);
                                                //var name = element.publisher + '.' + element.name + '-' + element.version;
                                                //vscode.window.showInformationMessage("Extension " + name + " installed Successfully");
                                            }));
                                    });
                                }
                                break;
                            }
                            default: {
                                if (file.fileName.indexOf("keybinding") == -1) {
                                    if (file.fileName.indexOf(".") > -1) {
                                        writeFile = true;
                                        await FileManager.CreateDirectory(en.FOLDER_SNIPPETS);
                                        var snippetFile = en.FOLDER_SNIPPETS.concat(file.fileName);//.concat(".json");
                                        path = snippetFile;
                                        content = file.content;
                                    }
                                }
                                break;
                            }
                        }
                        if (writeFile) {
                            await actionList.push(FileManager.WriteFile(path, content).then(
                                function (added: boolean) {
                                    //TODO : add Name attribute in File and show information message here with name , when required.
                                }, function (error: any) {
                                    common.LogException(error, common.ERROR_MESSAGE, true);
                                    return;
                                }
                            ));
                        }
                    }
                }
                else {
                    console.log(res);
                    vscode.window.showErrorMessage("Sync : Unable To Read Gist");
                }

                Promise.all(actionList)
                    .then(async function () {

                        // if (!syncSetting.showSummary) {
                        //     if (missingList.length == 0) {
                        //         //vscode.window.showInformationMessage("No extension need to be installed");
                        //     }
                        //     else {
                        //         //extension message when summary is turned off
                        //         vscode.window.showInformationMessage("Sync : " + missingList.length + " extensions installed Successfully, Restart Required.");
                        //     }
                        //     if (deletedExtensions.length > 0) {
                        //         vscode.window.showInformationMessage("Sync : " + deletedExtensions.length + " extensions deleted Successfully, Restart Required.");
                        //     }
                        // }

                        await common.SaveSettings(syncSetting).then(async function (added: boolean) {
                            if (added) {
                                //vscode.window.showInformationMessage("Sync : Download Complete.");
                                if (syncSetting.showSummary) {
                                    common.GenerateSummmaryFile(false, updatedFiles, deletedExtensions, addedExtensions, localSettings);
                                }
                                vscode.window.setStatusBarMessage("");
                                vscode.window.setStatusBarMessage("Sync : Download Complete.", 5000);

                                if (syncSetting.autoUpload) {
                                    common.StartWatch();
                                }
                            }
                            else {
                                vscode.window.showErrorMessage("Sync : Unable to save extension settings file.")
                            }
                        }, function (errSave: any) {
                            common.LogException(errSave, common.ERROR_MESSAGE, true);
                            return;
                        });
                    })
                    .catch(function (e) {
                        common.LogException(e, common.ERROR_MESSAGE, true);
                    });
            }, function (err: any) {
                common.LogException(err, common.ERROR_MESSAGE, true);
                return;
            });
        }
    });

    var resetSettings = vscode.commands.registerCommand('extension.resetSettings', async () => {
        var en: Environment = new Environment(context);
        var fManager: FileManager;
        var common: Commons = new Commons(en, context);
        var syncSetting: ExtensionConfig = new ExtensionConfig();

        await common.InitializeSettings(false, false).then(async (resolve) => {
            syncSetting = resolve;
            await Init();
        }, (reject) => {
            common.LogException(reject, common.ERROR_MESSAGE, true);

        });
        async function Init() {
            vscode.window.setStatusBarMessage("Sync : Resetting Your Settings.", 2000);
            try {
                syncSetting = new ExtensionConfig();

                await common.SaveSettings(syncSetting).then(function (added: boolean) {
                    if (added) {
                        vscode.window.showInformationMessage("GIST ID and Github Token Cleared.");
                    }
                }, function (err: any) {
                    common.LogException(err, common.ERROR_MESSAGE, true);
                    return;
                });

            }
            catch (err) {
                common.LogException(err, "Unable to clear settings. Error Logged on console. Please open an issue.", true);
            }
        }

    });

    var howSettings = vscode.commands.registerCommand('extension.HowSettings', async () => {
        openurl("http://shanalikhan.github.io/2015/12/15/Visual-Studio-Code-Sync-Settings.html");
    });

    var otherOptions = vscode.commands.registerCommand('extension.otherOptions', async () => {
        var en: Environment = new Environment(context);
        var common: Commons = new Commons(en, context);
        var setting: ExtensionConfig = null;
        var localSetting: LocalConfig = new LocalConfig();
        //var myGi: GithubService = null;
        var tokenAvailable: boolean = false;
        var gistAvailable: boolean = false;

        await common.InitializeSettings(false, false).then(async function (set: any) {
            if (set) {
                setting = set;
                tokenAvailable = setting.Token != null && setting.Token != "";
                gistAvailable = setting.Gist != null && setting.Gist != "";
                if (tokenAvailable) {
                    //myGi = new GithubService(setting.Token);
                }

            }

        }, function (err: any) {
            common.LogException(err, "Unable to toggle summary. Please open an issue.", true);
        });

        let items: Array<string> = new Array<string>();


        items.push("Sync : Share Settings with Public GIST");
        items.push("Sync : Toggle Force Download");
        items.push("Sync : Toggle Auto-Upload On Settings Change");
        items.push("Sync : Toggle Auto-Download On Startup");
        items.push("Sync : Toggle Show Summary Page On Upload / Download");
        items.push("Sync : Open Issue");
        items.push("Sync : Release Notes");


        var selectedItem: Number = 0;
        var settingChanged: boolean = false;

        var teims = vscode.window.showQuickPick(items).then(async (resolve: string) => {

            switch (resolve) {
                case items[0]: {
                    await vscode.window.showInformationMessage("Sync : This will remove current GIST and upload settings on new public GIST. Do you want to continue ?", "Yes").then((resolve) => {
                        if (resolve == "Yes") {
                            localSetting.publicGist = true;
                            settingChanged = true;
                            setting.Gist = "";
                            selectedItem = 0;
                        }
                    }, (reject) => {
                        return;
                    });
                    break;
                }
                case items[5]: {
                    openurl("https://github.com/shanalikhan/code-settings-sync/issues/new");
                    break;
                }
                case items[6]: {
                    openurl("http://shanalikhan.github.io/2016/05/14/Visual-studio-code-sync-settings-release-notes.html");
                    break;
                }
                case items[3]: {
                    //auto downlaod on startup
                    selectedItem = 3;
                    settingChanged = true;

                    if (!setting) {
                        vscode.commands.executeCommand('extension.HowSettings');
                        return;
                    }

                    if (!tokenAvailable || !gistAvailable) {
                        vscode.commands.executeCommand('extension.HowSettings');
                        return;
                    }
                    if (setting.autoDownload) {
                        setting.autoDownload = false;
                    }
                    else {
                        setting.autoDownload = true;
                    }
                    break;
                }
                case items[4]: {
                    //page summary toggle
                    selectedItem = 4;
                    settingChanged = true;

                    if (!tokenAvailable || !gistAvailable) {
                        vscode.commands.executeCommand('extension.HowSettings');
                        return;
                    }
                    if (setting.showSummary) {
                        setting.showSummary = false;
                    }
                    else {
                        setting.showSummary = true;
                    }
                    break;
                }
                case items[1]: {
                    //toggle force download
                    selectedItem = 1;
                    settingChanged = true;
                    if (setting.forceDownload) {
                        setting.forceDownload = false;
                    }
                    else {
                        setting.forceDownload = true;
                    }
                    break;
                }
                case items[2]: {
                    //toggle auto upload
                    selectedItem = 2;
                    settingChanged = true;
                    if (setting.autoUpload) {
                        setting.autoUpload = false;
                    }
                    else {
                        setting.autoUpload = true;
                    }
                    break;
                }

                default: {
                    break;
                }
            }
        }, (reject) => {
            common.LogException(reject, "Error", true);
            return;
        }).then(async (resolve: any) => {
            if (settingChanged) {
                await common.SaveSettings(setting).then(async function (added: boolean) {
                    if (added) {
                        switch (selectedItem) {
                            case 3: {
                                if (setting.autoDownload) {
                                    vscode.window.showInformationMessage("Sync : Auto Download turned ON upon VSCode Startup.");
                                }
                                else {
                                    vscode.window.showInformationMessage("Sync : Auto Download turned OFF upon VSCode Startup.");
                                }
                                break;
                            }
                            case 4: {
                                if (setting.showSummary) {
                                    vscode.window.showInformationMessage("Sync : Summary Will be shown upon download / upload.");
                                }
                                else {
                                    vscode.window.showInformationMessage("Sync : Summary Will be hidden upon download / upload.");
                                }
                                break;
                            }
                            case 1: {
                                if (setting.forceDownload) {
                                    vscode.window.showInformationMessage("Sync : Force Download Turned On.");
                                }
                                else {
                                    vscode.window.showInformationMessage("Sync : Force Download Turned Off.");
                                }
                                break;
                            }
                            case 2: {
                                if (setting.autoUpload) {
                                    vscode.window.showInformationMessage("Sync : Auto upload on Setting Change Turned On. Will be affected after restart.");
                                }
                                else {
                                    vscode.window.showInformationMessage("Sync : Auto upload on Setting Change Turned Off.");
                                }
                                break;
                            }
                            case 0: {
                                await vscode.commands.executeCommand('extension.updateSettings', "publicGIST");
                                break;
                            }
                        }
                    }
                    else {
                        vscode.window.showErrorMessage("Unable to Toggle.");
                    }
                }, function (err: any) {
                    common.LogException(err, "Unable to toggle. Please open an issue.", true);
                    return;
                });
            }

        }, (reject: any) => {
            common.LogException(reject, "Error", true);
            return;
        });
    });

    context.subscriptions.push(updateSettings);
    context.subscriptions.push(downloadSettings);
    context.subscriptions.push(resetSettings);
    context.subscriptions.push(howSettings);
    context.subscriptions.push(otherOptions);

}
