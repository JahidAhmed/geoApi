'use strict';

const layerRecord = require('./layerRecord.js')();
const basicFC = require('./basicFC.js')();
const shared = require('./shared.js')();

/**
 * @class ImageRecord
 */
class ImageRecord extends layerRecord.LayerRecord {
    // NOTE: if we decide to support attributes from ImageServers,
    //       we would extend from AttribRecord instead of LayerRecord
    //       (and do a lot of testing!)

    /**
     * Create a layer record with the appropriate geoApi layer type.  Layer config
     * should be fully merged with all layer options defined (i.e. this constructor
     * will not apply any defaults).
     * @param {Object} layerClass    the ESRI api object for image server layers
     * @param {Object} apiRef        object pointing to the geoApi. allows us to call other geoApi functions.
     * @param {Object} config        layer config values
     * @param {Object} esriLayer     an optional pre-constructed layer
     * @param {Function} epsgLookup  an optional lookup function for EPSG codes (see geoService for signature)
     */
    constructor (layerClass, apiRef, config, esriLayer, epsgLookup) {
        // TEST STATUS none
        // TODO if we have nothing to add here, delete this constructor
        super(layerClass, apiRef, config, esriLayer, epsgLookup);
    }

    get layerType () { return Promise.resolve(shared.clientLayerType.ESRI_IMAGE); }

    /**
    * Triggers when the layer loads.
    *
    * @function onLoad
    */
    onLoad () {
        // TEST STATUS none
        super.onLoad();

        // TODO consider making this a function, as it is common across less-fancy layers
        this._defaultFC = '0';
        this._featClasses['0'] = new basicFC.BasicFC(this, '0', this.config);

        this.getSymbology().then(symbolArray => {
            // remove anything from the stack, then add new symbols to the stack
            this.symbology.stack.splice(0, this.symbology.stack.length, ...symbolArray);
        });
    }
}

module.exports = () => ({
    ImageRecord
});