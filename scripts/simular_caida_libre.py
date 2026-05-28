import cv2
import numpy as np
import os

width, height = 640, 480
fps = 30
duration = 5  # segundos

# Física escalada: 1 m = 45 px → g ≈ 441 px/s²
# Produce ~1.9 s de caída visible (≈57 frames detectados)
g = 9.8 * 45
radius = 22

x_pos = width // 2
y_start = float(radius + 8)
floor_y = height - radius - 8

script_dir = os.path.dirname(os.path.abspath(__file__))
output_path = os.path.join(script_dir, "..", "data", "caida_libre_simulacion.mp4")

fourcc = cv2.VideoWriter_fourcc(*'mp4v')
out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

pause_frames = fps  # 1 s con la pelota quieta antes de soltar
total_frames = fps * duration

y_pos = y_start
v_y = 0.0
dt = 1.0 / fps
falling = False

for frame_idx in range(total_frames):
    if frame_idx >= pause_frames:
        falling = True

    if falling and y_pos < floor_y:
        v_y += g * dt
        y_pos += v_y * dt
        y_pos = min(y_pos, floor_y)

    frame = np.ones((height, width, 3), dtype=np.uint8) * 255

    # Línea de suelo de referencia
    cv2.line(frame, (0, height - 16), (width, height - 16), (160, 160, 160), 2)

    # Pelota roja (BGR) — detectable con filtro HSV por defecto de la app
    if y_pos <= floor_y:
        cy = int(y_pos)
        cv2.circle(frame, (x_pos, cy), radius, (0, 0, 220), -1)
        cv2.circle(frame, (x_pos, cy), radius, (0, 0, 150), 2)

    out.write(frame)

out.release()
print(f"Video generado: {output_path}")
