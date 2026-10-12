import largeFiles from './large-files.json';
import {createAssetHandler} from './assets.js';
export default {fetch:createAssetHandler(largeFiles)};
