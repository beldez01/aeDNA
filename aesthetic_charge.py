import cv2
import numpy as np
from skimage import color
import matplotlib.pyplot as plt

def compute_aesthetic_charge(image_path, kernel_size=5, weights=(1.0, 1.0, 1.0, 0.5, 0.3)):
    """
    Computes aesthetic charge q(x, y) based on local contrast and curvature in CIELAB space.

    Parameters:
        image_path (str): Path to input image
        kernel_size (int): Size of neighborhood window for local averaging
        weights (tuple): Weights for (L_diff, a_diff, b_diff, Laplacian, entropy)

    Returns:
        q (np.ndarray): Aesthetic charge field (2D array)
    """
    # Load image and convert to Lab
    bgr = cv2.imread(image_path)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    lab = color.rgb2lab(rgb)  # Returns float image in Lab space

    L, a, b = lab[:, :, 0], lab[:, :, 1], lab[:, :, 2]

    # Define kernel for local mean
    kernel = np.ones((kernel_size, kernel_size)) / (kernel_size ** 2)

    # Local averages
    L_mean = cv2.filter2D(L, -1, kernel)
    a_mean = cv2.filter2D(a, -1, kernel)
    b_mean = cv2.filter2D(b, -1, kernel)

    # Differences
    L_diff = np.abs(L - L_mean)
    a_diff = np.abs(a - a_mean)
    b_diff = np.abs(b - b_mean)

    # Laplacian (light curvature)
    L_lap = cv2.Laplacian(L, cv2.CV_64F)
    L_lap_abs = np.abs(L_lap)

    # Local entropy (texture complexity)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256])
    hist = hist / hist.sum()
    entropy_val = -np.sum(hist * np.log2(hist + 1e-9))
    entropy = np.full_like(L, entropy_val)  # Flat entropy as placeholder

    # Weights
    w1, w2, w3, w4, w5 = weights

    # Compute aesthetic charge
    q = (w1 * L_diff +
         w2 * a_diff +
         w3 * b_diff +
         w4 * L_lap_abs +
         w5 * entropy)

    return q, rgb


def visualize_aesthetic_charge(q, rgb):
    plt.figure(figsize=(12, 6))
    plt.subplot(1, 2, 1)
    plt.imshow(rgb)
    plt.title("Original Image")
    plt.axis('off')

    plt.subplot(1, 2, 2)
    plt.imshow(q, cmap='inferno')
    plt.title("Aesthetic Charge Map")
    plt.axis('off')
    plt.tight_layout()
    plt.show()

# Example usage:
# q_field, image_rgb = compute_aesthetic_charge("path/to/image.jpg")
# visualize_aesthetic_charge(q_field, image_rgb)
