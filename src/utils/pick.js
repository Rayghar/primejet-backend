   // src/utils/pick.js

   /**
    * Creates an object composed of the picked object properties.
    * Useful for selecting specific fields from request objects or filtering data.
    *
    * @param {Object} object - The source object.
    * @param {string[]} keys - An array of property names (strings) to pick.
    * @returns {Object} A new object with only the picked properties that exist on the source object.
    */
   const pick = (object, keys) => {
     if (!object || typeof object !== 'object' || !Array.isArray(keys)) {
       return {};
     }
     return keys.reduce((obj, key) => {
       if (Object.prototype.hasOwnProperty.call(object, key)) {
         // eslint-disable-next-line no-param-reassign
         obj[key] = object[key];
       }
       return obj;
     }, {});
   };

   module.exports = pick;
   