    // src/utils/apiResponse.js

    /**
     * Provides static methods for sending standardized successful API responses.
     */
    class ApiResponse {
      /**
       * Sends a 200 OK response.
       * @param {import('express').Response} res Express response object.
       * @param {any} data The payload/data to send.
       * @param {string} [message='Operation successful.'] Optional success message.
       */
      static ok(res, data, message = 'Operation successful.') {
        res.status(200).json({
          success: true,
          message,
          data,
        });
      }

      /**
       * Sends a 201 Created response.
       * @param {import('express').Response} res Express response object.
       * @param {any} data The created resource or relevant data.
       * @param {string} [message='Resource created successfully.'] Optional success message.
       */
      static created(res, data, message = 'Resource created successfully.') {
        res.status(201).json({
          success: true,
          message,
          data,
        });
      }

      /**
       * Sends a 204 No Content response.
       * Typically used for successful DELETE operations where no body is returned.
       * @param {import('express').Response} res Express response object.
       */
      static noContent(res) {
        res.status(204).send();
      }

      // Add other common success response types as needed (e.g., 202 Accepted)
    }

    module.exports = ApiResponse;
    