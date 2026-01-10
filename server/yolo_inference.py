#!/usr/bin/env python3
"""
YOLOv8 Object Detection using ONNX Runtime
Detects vehicles, people, and other objects in parking enforcement images.
"""

import sys
import json
import os
import numpy as np
from PIL import Image
import onnxruntime as ort

# COCO class names that YOLOv8 is trained on
COCO_CLASSES = [
    'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
    'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
    'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
    'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
    'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
    'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
    'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
    'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
    'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
    'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
    'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier',
    'toothbrush'
]

# Classes relevant to parking enforcement
VEHICLE_CLASSES = {'car', 'truck', 'bus', 'motorcycle', 'bicycle'}
PERSON_CLASSES = {'person'}

def preprocess_image(image_path, input_size=640):
    """Preprocess image for YOLOv8 inference."""
    img = Image.open(image_path).convert('RGB')
    original_size = img.size  # (width, height)
    
    # Resize while maintaining aspect ratio
    ratio = min(input_size / img.width, input_size / img.height)
    new_size = (int(img.width * ratio), int(img.height * ratio))
    img_resized = img.resize(new_size, Image.BILINEAR)
    
    # Create padded image
    padded = Image.new('RGB', (input_size, input_size), (114, 114, 114))
    paste_x = (input_size - new_size[0]) // 2
    paste_y = (input_size - new_size[1]) // 2
    padded.paste(img_resized, (paste_x, paste_y))
    
    # Convert to numpy and normalize
    img_array = np.array(padded).astype(np.float32) / 255.0
    img_array = np.transpose(img_array, (2, 0, 1))  # HWC -> CHW
    img_array = np.expand_dims(img_array, axis=0)  # Add batch dimension
    
    return img_array, original_size, ratio, (paste_x, paste_y)

def postprocess(output, original_size, ratio, padding, conf_threshold=0.25, iou_threshold=0.45):
    """Post-process YOLOv8 output to get detections."""
    predictions = np.array(output[0])
    
    # YOLOv8 output shape: [1, 84, 8400] - 84 = 4 bbox + 80 classes
    # Need to transpose to [1, 8400, 84] then remove batch dim to get [8400, 84]
    if len(predictions.shape) == 3:
        # Shape is [1, 84, 8400] - transpose to [1, 8400, 84]
        predictions = np.transpose(predictions, (0, 2, 1))
        predictions = predictions[0]  # Remove batch dimension: [8400, 84]
    elif len(predictions.shape) == 2:
        # Already [84, 8400] or [8400, 84]
        if predictions.shape[0] == 84:
            predictions = predictions.T  # Transpose to [8400, 84]
    
    detections = []
    paste_x, paste_y = padding
    
    for pred in predictions:
        # Get class scores (indices 4 onwards)
        class_scores = pred[4:]
        max_score_idx = np.argmax(class_scores)
        max_score = class_scores[max_score_idx]
        
        if max_score < conf_threshold:
            continue
        
        # Get bounding box (center_x, center_y, width, height)
        cx, cy, w, h = pred[:4]
        
        # Convert to corner coordinates
        x1 = (cx - w/2 - paste_x) / ratio
        y1 = (cy - h/2 - paste_y) / ratio
        x2 = (cx + w/2 - paste_x) / ratio
        y2 = (cy + h/2 - paste_y) / ratio
        
        # Clip to image bounds
        x1 = max(0, min(x1, original_size[0]))
        y1 = max(0, min(y1, original_size[1]))
        x2 = max(0, min(x2, original_size[0]))
        y2 = max(0, min(y2, original_size[1]))
        
        class_name = COCO_CLASSES[max_score_idx] if max_score_idx < len(COCO_CLASSES) else 'unknown'
        
        detections.append({
            'class': class_name,
            'class_id': int(max_score_idx),
            'confidence': float(max_score),
            'bbox': [float(x1), float(y1), float(x2), float(y2)]
        })
    
    # Simple NMS
    detections = sorted(detections, key=lambda x: x['confidence'], reverse=True)
    final_detections = []
    
    for det in detections:
        keep = True
        for kept in final_detections:
            if det['class'] == kept['class']:
                iou = calculate_iou(det['bbox'], kept['bbox'])
                if iou > iou_threshold:
                    keep = False
                    break
        if keep:
            final_detections.append(det)
    
    return final_detections

def calculate_iou(box1, box2):
    """Calculate Intersection over Union."""
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])
    
    inter_area = max(0, x2 - x1) * max(0, y2 - y1)
    box1_area = (box1[2] - box1[0]) * (box1[3] - box1[1])
    box2_area = (box2[2] - box2[0]) * (box2[3] - box2[1])
    
    union_area = box1_area + box2_area - inter_area
    return inter_area / union_area if union_area > 0 else 0

def run_inference(image_path, model_path=None):
    """Run YOLOv8 inference on an image."""
    if model_path is None:
        # Default model path
        model_path = os.path.join(os.path.dirname(__file__), 'models', 'yolov8n.onnx')
    
    if not os.path.exists(model_path):
        return {
            'success': False,
            'error': f'Model not found at {model_path}. Please download YOLOv8n ONNX model.',
            'vehicles': [],
            'persons': [],
            'all_detections': []
        }
    
    if not os.path.exists(image_path):
        return {
            'success': False,
            'error': f'Image not found at {image_path}',
            'vehicles': [],
            'persons': [],
            'all_detections': []
        }
    
    try:
        # Load model
        session = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])
        input_name = session.get_inputs()[0].name
        
        # Preprocess
        img_array, original_size, ratio, padding = preprocess_image(image_path)
        
        # Run inference
        outputs = session.run(None, {input_name: img_array})
        
        # Postprocess
        detections = postprocess(outputs[0], original_size, ratio, padding)
        
        # Categorize detections
        vehicles = [d for d in detections if d['class'] in VEHICLE_CLASSES]
        persons = [d for d in detections if d['class'] in PERSON_CLASSES]
        
        return {
            'success': True,
            'vehicles': vehicles,
            'persons': persons,
            'all_detections': detections,
            'model': 'yolov8n'
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'vehicles': [],
            'persons': [],
            'all_detections': []
        }

def check_model_available(model_path=None):
    """Check if YOLO model is available."""
    if model_path is None:
        model_path = os.path.join(os.path.dirname(__file__), 'models', 'yolov8n.onnx')
    return os.path.exists(model_path) and os.path.getsize(model_path) > 1000000  # At least 1MB

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Usage: python yolo_inference.py <image_path> [model_path]'}))
        sys.exit(1)
    
    # Check mode
    if sys.argv[1] == '--check':
        available = check_model_available(sys.argv[2] if len(sys.argv) > 2 else None)
        print(json.dumps({'available': available}))
        sys.exit(0)
    
    image_path = sys.argv[1]
    model_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    result = run_inference(image_path, model_path)
    print(json.dumps(result))
