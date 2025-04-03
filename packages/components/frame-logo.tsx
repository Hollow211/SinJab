import React from "react";

import {
  type ChakraProps,
  Image,
  chakra,
  useColorMode,
} from "@chakra-ui/react";

export const FrameLogo: React.FC<ChakraProps> = (props) => {
  const { colorMode } = useColorMode();

  const imgSrc =
    colorMode !== "dark" ? "/logo_ghost_light.png" : "/logo_ghost.png";

  return (
    <Image
      src={imgSrc}
      boxSize={props.boxSize}
      height={props.height || props.h}
      width={props.width || props.w}
    />
  );
};
