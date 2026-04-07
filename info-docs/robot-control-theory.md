Robot control theory
November 11, 2024
## Course contents
• Theme 1: The role of robotics in society and an introduction to
ethical issues in robotics
• Theme 2: Different types of robots and their application to realworld problems
• Theme 3: Robot control theory
• Theme 4: Navigation
• Theme 5: Robotics & AI
• Theme 6: Extended Reality applications in robotics
ROBOTICS & XR (5 ECTS)
Some recap from the last week • ROS 2 as framework • Topics, nodes, actions, services • Issues encountered • Docker / ROS installation and configuration • Running simulation is GPU intensive • Varying platforms • A (partial) solution: remotely accessible sandbox • Demo
ROBOTICS & XR (5 ECTS)
Theme 3: Robot control theory • Week 46 (November 11 – 17) • Theory of robot control • Basics of matrix computation and linear algebra • Odometry and sensor fusion, applicable filters
ROBOTICS & XR (5 ECTS)
## Core concepts
• Transformations (tf)
• Frames
• Odometry
• Mapping
• Localization
• Navigation
## Transformations (tf)
• Provide information on how a robot could move in n-dimensional
space
• A mobile robot typically moves in 2D space and is able to rotate (3
DOF)
• Translation: Changing position in Cartesian 2D coordinate system
• Rotation: Rotating the object in the space
• Scaling, shearing, mirroring (manipulating size and shape of the
object)
• Useful not only in robotics, but also in computer graphics and game
design
## Transformations
• Transformation matrix – rotate and translate
Kuva, joka sisältää kohteen teksti, diagrammi, kuvakaappaus, piirros
Kuvaus luotu automaattisesti
https://articulatedrobotics.xyz/tutorials/coordinate-transforms/transformation-matrices
## Breaking down the matrix
• Representing a point in 2D / 3D Cartesian space
Linear transformation and identity matrix
• f(p)=Ap
• where A is an n x n matrix, n is
number of dimensions in p
• If the function is something else
than two matrices multiplied, it is
non-linear
• When multiplying a point matrix
with identity matrix, we get the
same result
# Rotation – defining transformation matrix
## Translation – moving in coordinates
• Non-linear function f(p)=p+b
• Use of homogenous coordinates help
to derive translation matrix (linear
function) – affine transformation
## Transformation matrices
• First, we need to augment
rotation matrix to
homogenous coordinates
• Integrating with translation
matrix
## Core concepts
• Transformations (tf)
• Frames
• Odometry
• Mapping
• Localization
• Navigation
## Frame
• A reference point in 2D or 3D space that helps to understand and describe
position and orientation of an object
• Every object in a robotics application has its own frame
• Coordinate system to measure object’s poosition and orientation
• Frames are either fixed (e.g. map) or mobile (e.g. robot’s base frame)
• Frames hierarchy
• Robot’s frame attached to its base -> frame moves when the robot moves
• Robot’s accessories are mounted to this frame -> they also move
• ROS2: tf2 library keeps track on frames and how they move in the space
• Transformation tree: relations between the frames (e.g. map->robot)
## Core concepts
• Transformations (tf)
• Frames
• Odometry
• Mapping
• Localization
• Navigation
## Odometry
• Robot tracks its position based on previous positions and its
movements (translations and rotations in space)
• Multiple sensor inputs (e.g. wheel encoders, IMU, gyroscope)
• Accumulating movements in the space
• Relying only one type of sensor (for example wheel encoder) is
usually unreliable (why?)
• How to improve odometry?
## Sensor fusion
• Combining data from various sources
• Reducing uncertainty and increasing robustness of the system
• Camera, LIDAR, GPS, IMU, encoders, …
• Kalman filters (and other algorithms) and/or sensor data weighting to
combine data efficiently
• If one sensor fails, the others continue providing information
• Noise reduction and increased precision
• Consider autonomous cars: What sensors might be included in
fusion?