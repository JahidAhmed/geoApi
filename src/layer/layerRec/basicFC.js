'use strict';

const shared = require('./shared.js')();
const placeholderFC = require('./placeholderFC.js')();

/**
 * @class BasicFC
 */
class BasicFC extends placeholderFC.PlaceholderFC {
    // base class for feature class object. deals with stuff specific to a feature class (or raster equivalent)

    get queryable () { return this._queryable; }
    set queryable (value) { this._queryable = value; }

    // non-attributes have no geometry.
    // TODO decide on proper defaulting or handling of non-geometry layers.
    get geomType () { return Promise.resolve('none'); }

    /**
     * @param {Object} parent        the Record object that this Feature Class belongs to
     * @param {String} idx           the service index of this Feature Class. an integer in string format. use '0' for non-indexed sources.
     * @param {Object} layerPackage  a layer package object from the attribute module for this feature class
     * @param {Object} config        the config object for this sublayer
     */
    constructor (parent, idx, layerPackage, config) {
        super(parent, config.name || '');
        this._idx = idx;
        this._layerPackage = layerPackage;
        this.queryable = config.state.query;
        this.extent = config.extent;  // if missing, will fill more values after layer loads

        // TODO do we need to store a copy of the config? for the memories?

    }

    /**
     * Returns an object with minScale and maxScale values for the feature class.
     *
     * @function getScaleSet
     * @returns {Object} scale set for the feature class
     */
    getScaleSet () {
        // basic case - we get it from the esri layer
        // TODO need to test for missing layer??
        const l = this._parent._layer;
        return {
            minScale: l.minScale,
            maxScale: l.maxScale
        };
    }

    /**
     * Indicates if the feature class is not visible at the given scale,
     * and if so, if we need to zoom in to see it or zoom out
     *
     * @function isOffScale
     * @param {Integer}  mapScale the scale to test against
     * @returns {Object} has boolean properties `offScale` and `zoomIn`
     */
    isOffScale (mapScale) {
        const scaleSet = this.getScaleSet();

        // GIS for dummies.
        // scale increases as you zoom out, decreases as you zoom in
        // minScale means if you zoom out beyond this number, hide the layer
        // maxScale means if you zoom in past this number, hide the layer
        // 0 value for min or max scale means there is no hiding in effect
        const result = {
            offScale: false,
            zoomIn: false
        };

        // check if out of scale and set zoom direction to scaleSet
        if (mapScale < scaleSet.maxScale && scaleSet.maxScale !== 0) {
            result.offScale = true;
            result.zoomIn = false;
        } else if (mapScale > scaleSet.minScale && scaleSet.minScale !== 0) {
            result.offScale = true;
            result.zoomIn = true;
        }

        return result;
    }

    /**
     * Returns the visibility of the feature class.
     *
     * @function getVisibility
     * @returns {Boolean} visibility of the feature class
     */
    getVisibility () {
        return this._parent._layer.visible;
    }

    /**
     * Applies visibility to feature class.
     *
     * @function setVisibility
     * @param {Boolean} value the new visibility setting
     */
    setVisibility (value) {
        // basic case - set layer visibility
        this._parent._layer.setVisibility(value);
    }

    /**
     * Download or refresh the internal symbology for the FC.
     * mergeAllLayers indicates we should collate entire parent legend into one block.
     * E.g. for basemap tile. the FC index would be 0, but we want all indexes
     *
     * @function loadSymbology
     * @param {Boolean}     mergeAllLayers take entire service legend, no just legend for this FC. Defaults to false.
     * @returns {Promise}   resolves when symbology has been downloaded
     */
    loadSymbology (mergeAllLayers = false) {
        // get symbology from service legend.
        // this is used for non-feature based sources (tiles, image, raster).
        // wms will override with own special logic.
        const url = this._parent._layer.url;
        if (url) {
            // fetch legend from server, convert to local format, process local format
            const legendIndex = mergeAllLayers ? undefined : this._idx;
            return this._parent._apiRef.symbology.mapServerToLocalLegend(url, legendIndex)
                .then(legendData => {
                    this.symbology = shared.makeSymbologyArray(legendData.layers[0].legend);
                });
        } else {
            // this shouldn't happen. non-url layers should be files, which are features,
            // which will have a basic renderer and will use FeatureFC override.
            throw new Error('encountered layer with no renderer and no url');
        }
    }

    /**
     * Zoom to the boundary of the FC.
     * @param {Object} map  esriMap object we want to execute the zoom on
     * @return {Promise} resolves when map is done zooming
     */
    zoomToBoundary (map) {
        return map.zoomToExtent(this.extent);
    }

    /**
     * Zoom to a valid scale level for this layer.
     *
     * @function zoomToScale
     * @param {Object} map                   the map object
     * @param {Array} lods                   level of details array for basemap
     * @param {Boolean} zoomIn               the zoom to scale direction; true need to zoom in; false need to zoom out
     * @param {Boolean} positionOverLayer    ensures the map is over the layer's extent after zooming. only applied if zoomIn is true. defaults to true
     * @returns {Promise}                    promise that resolves after map finishes moving about
     */
    zoomToScale (map, lods, zoomIn, positionOverLayer = true) {
        // get scale set from child, then execute zoom
        const scaleSet = this.getScaleSet();
        return this._parent._zoomToScaleSet(map, lods, zoomIn, scaleSet, positionOverLayer);
    }

    /**
     * Returns layer-specific data for this FC.
     *
     * @function getLayerData
     * @returns {Promise}         resolves with a layer data object
     */
    getLayerData (webRequest, dataUrl) {
        if (this._layerPackage.layerData) {
            // layer data already set.
            return this._layerPackage.layerData;
        }

        const request = webRequest(dataUrl);
        this._layerPackage.layerData = new Promise((resolve, reject) => {
            const layerData = {};

            request.then(result => {
                result.fields.every(elem => {
                    if (elem.type === 'esriFieldTypeOID') {
                        layerData.oidField = elem.name;
                        return false; // break the loop
                    }

                    return true; // keep looping
                });
                layerData.fields = result.fields;
                layerData.renderer = { type: 'simple' };
                layerData.geometryType = 'none';

                resolve(layerData);
            }, error => {
                console.warn('error getting layer data');
                reject(error);
            });
        });

        return this._layerPackage.layerData;
    }

    getAttribs (webRequest, dataUrl) {
        if (this._layerPackage._attribData) {
            // attributes have already been downloaded.
            return this._layerPackage._attribData;
        }

        const request = webRequest(dataUrl);
        this._layerPackage._attribData = new Promise((resolve, reject) => {
            request.then(result => {
                this._layerPackage.loadIsDone = true;

                // resolve the promise with the attribute set
                resolve(createAttribSet('OBJECTID', result.features));
            }, error => {
                console.warn('error getting attribute data');

                // attrib data deleted so the first check for attribData doesn't return a rejected promise
                delete this._layerPackage._attribData;
                reject(error);
            });
        });

        return this._layerPackage._attribData;

        /**
         * Will generate attribute package with object id indexes
         * @private
         * @param  {String} oidField field containing object id
         * @param  {Array} featureData feature objects to index and return
         * @return {Object} object containing features and an index by object id
         */
        function createAttribSet(oidField, featureData) {

            // add new data to layer data's array
            const res = {
                features: featureData,
                oidIndex: {}
            };

            // make index on object id
            featureData.forEach((elem, idx) => {
                // map object id to index of object in feature array
                // use toString, as objectid is integer and will act funny using array notation.
                res.oidIndex[elem.attributes[oidField].toString()] = idx;
            });

            return res;
        }
    }

    /**
     * Retrieves attributes from a layer for a specified feature index
     * @return {Promise}            promise resolving with formatted attributes to be consumed by the datagrid and esri feature identify
     */
    getFormattedAttributes (webRequest, dataUrl) {
        if (this._formattedAttributes) {
            return this._formattedAttributes;
        }

        // TODO after refactor, consider changing this to a warning and just return some dummy value
        if (this.layerType === shared.clientLayerType.ESRI_RASTER) {
            throw new Error('Attempting to get attributes on a raster layer.');
        }

        this._formattedAttributes = Promise.all([this.getAttribs(webRequest, dataUrl), this.getLayerData(webRequest, dataUrl)])
            .then(([aData, lData]) => {
                // create columns array consumable by datables
                const columns = lData.fields
                    .filter(field =>

                        // assuming there is at least one attribute - empty attribute budnle promises should be rejected, so it never even gets this far
                        // filter out fields where there is no corresponding attribute data
                        aData.features[0].attributes.hasOwnProperty(field.name))
                    .map(field => ({
                        data: field.name,
                        title: field.alias || field.name
                    }));

                // derive the icon for the row
                const rows = aData.features.map(feature => {
                    const att = feature.attributes;
                    att.rvInteractive = '';
                    att.rvSymbol = this._parent._apiRef.symbology.getGraphicIcon(att, lData.renderer);
                    return att;
                });

                // if a field name resembles a function, the data table will treat it as one.
                // to get around this, we add a function with the same name that returns the value,
                // tricking that silly datagrid.
                columns.forEach(c => {
                    if (c.data.substr(-2) === '()') {
                        // have to use function() to get .this to reference the row.
                        // arrow notation will reference the attribFC class.
                        const secretFunc = function() {
                            return this[c.data];
                        };

                        const stub = c.data.substr(0, c.data.length - 2); // function without brackets
                        rows.forEach(r => {
                            r[stub] = secretFunc;
                        });
                    }
                });

                return {
                    columns,
                    rows,
                    fields: lData.fields, // keep fields for reference ...
                    oidField: lData.oidField, // ... keep a reference to id field ...
                    oidIndex: aData.oidIndex, // ... and keep id mapping array
                    renderer: lData.renderer
                };
            })
            .catch(e => {
                delete this._formattedAttributes; // delete cached promise when the geoApi `getAttribs` call fails, so it will be requested again next time `getAttributes` is called;
                if (e === 'ABORTED') {
                    throw new Error('ABORTED');
                } else {
                    throw new Error('Attrib loading failed');
                }
            });

        return this._formattedAttributes;
    }
}

module.exports = () => ({
    BasicFC
});
