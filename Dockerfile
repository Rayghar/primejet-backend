# Step 1: Choose a base image.
# We use a specific version of Node.js (e.g., 18) and 'alpine' for a smaller image size.
# REPLACE '18-alpine' with the major version you found in Step 1 (e.g., '20-alpine' if you have Node.js 20).
FROM node:18-alpine

# Step 2: Set the working directory inside the container.
# All subsequent commands will run in this '/app' directory inside the container.
WORKDIR /app

# Step 3: Copy package.json and package-lock.json first.
# This helps Docker cache dependencies, speeding up future builds if only code changes.
COPY package*.json ./

# Step 4: Install Node.js dependencies.
# '--production' means it will only install dependencies listed in 'dependencies'
# section of package.json, not 'devDependencies', making the image smaller.
RUN npm install --production

# Step 5: Copy the rest of your application code into the container.
# The '.' copies everything from your project's root directory into '/app' in the container.
COPY . .

# Step 6: Expose the port your Node.js app listens on.
# Replace '3000' with the actual port your backend uses (e.g., if it's app.listen(8080)).
EXPOSE 3000

# Step 7: Define the command to run when the container starts.
# This should be the same command you use to start your Node.js app locally (e.g., 'npm start').
CMD [ "npm", "start" ]