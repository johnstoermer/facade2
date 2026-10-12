import largeFiles from './large-files.json';
import remoteFiles from './remote-files.json';
import {createAssetHandler} from './assets.js';
export default {fetch:createAssetHandler(largeFiles,remoteFiles)};
