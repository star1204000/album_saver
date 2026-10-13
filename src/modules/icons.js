/* ============================================================
 * icons.js · lucide 图标按需注册表
 * ------------------------------------------------------------
 * 项目实际用到的图标集中注册（tree-shaking 掉其余 1400+ 个），
 * 主包体积从 ~620KB 降至 ~100KB 内。
 * 新增图标时：import 进来 + 加入 iconRegistry 即可。
 * ============================================================ */
import {
  Sun, Moon, Play, X, Minus, Square, Copy,
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
  Trash2, GripVertical,
  ImagePlus, ImageOff, Image,
  Calendar, MapPin, Navigation, Map, Wind,
  FileJson, Download,
  CheckCircle2, AlertCircle, Info
} from 'lucide'

export const iconRegistry = {
  Sun, Moon, Play, X, Minus, Square, Copy,
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
  Trash2, GripVertical,
  ImagePlus, ImageOff, Image,
  Calendar, MapPin, Navigation, Map, Wind,
  FileJson, Download,
  CheckCircle2, AlertCircle, Info
}
